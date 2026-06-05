// 트라이아지 결정 — DOMAIN.md §4 자동 머지 정책의 한 곳 구현.
// decideTriage는 pure. runTriage는 DB read/write.

import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { preReviews, prs, projects, triageDecisions } from '@/db/schema';
import type { TriageDecisionRow } from '@/db/schema';
import { getPRReadiness, isCortexReadyMarker, isUntrustedAuthorAssociation } from './github';
import { logger } from './logger';

export type TriageDecision = TriageDecisionRow['decision'];

export type TriageResult = {
  decision: TriageDecision;
  reason: string;
};

export type TriageInput = {
  authorKind: 'agent' | 'human';
  confidence: number;
  flags: ReadonlyArray<string>;
  testsPassed: boolean | null;
  // GitHub mergeable_state. CI 없는 레포는 'clean' 으로 오므로, testsPassed 가 null 이어도
  // 'clean' 이면 머지 가능으로 본다 (CI 결과를 영원히 기다리지 않게).
  mergeableState: string | null;
  autoMergeEnabled: boolean;
  // Phase 5 readiness gate — "작업 완료" 가 명시되지 않은 PR 은 자동 머지 대상 아님(race 박제).
  // draft 면 머지 보류. lastCommitReady=false 면 머지 보류. 둘 중 하나라도 만족하면 통과.
  isDraft: boolean;
  lastCommitReady: boolean;
  // GitHub author_association (위조 불가). 외부 기여자(NONE/CONTRIBUTOR 등)는 자동 머지 차단.
  // null 이면(legacy·PAT webhook) 게이트 미적용(무회귀). authorKind(본문 마커·위조 가능)와 독립.
  authorAssociation: string | null;
  // 프로젝트의 충돌 자동 해결 토글. dirty(머지 충돌) PR 을 어떻게 다룰지 결정 —
  // ON 이면 auto-merge 흐름의 conflict-resolve 가 처리하도록 통과, OFF 면 human-review.
  autoResolveConflictsEnabled: boolean;
};

// 자동 머지 차단 플래그 (DOMAIN.md §4 룰 3).
const BLOCKING_FLAGS = new Set([
  'payment-domain',
  'auth-domain',
  'migration',
  'security-sensitive',
  'external-api-new',
]);

// 자동 머지 조건은 AND. 하나라도 어기면 human-review.
// 각 거부 사유는 한국어 한 줄로 반환 (UI 노출용).
export function decideTriage(input: TriageInput): TriageResult {
  if (input.authorKind === 'human') {
    return {
      decision: 'human-review',
      reason: '사람 작성 PR — 자동 머지 정책에서 항상 제외됩니다.',
    };
  }

  // 권한 게이트 — authorKind 는 PR 본문 마커 기반이라 위조 가능. GitHub 이 계산하는 author_association
  // (위조 불가)으로 외부 기여자(레포 멤버/협업자 아님)는 자동 머지에서 제외한다. null(legacy·PAT)이면
  // 미적용(무회귀). 이로써 외부 PR 이 본문에 마커를 넣어 자동 머지를 유발하는 권한 상승을 차단.
  if (isUntrustedAuthorAssociation(input.authorAssociation)) {
    return {
      decision: 'human-review',
      reason: '외부 기여자 PR (레포 멤버·협업자 아님) — 자동 머지 정책에서 제외됩니다.',
    };
  }

  if (!input.autoMergeEnabled) {
    return {
      decision: 'human-review',
      reason: '레포의 자동 머지 정책이 꺼져 있습니다.',
    };
  }

  // Readiness gate — "작업 완료" 명시가 있어야 자동 머지(분석 후 새 commit 푸시되는 race 박제).
  // 두 신호 중 하나라도 만족하면 ready:
  //   1. PR draft 해제 (GitHub native — 사람 PR 의 표준 흐름)
  //   2. 마지막 commit message 에 `Cortex: ready` trailer (위임 PR — agent push 만으로 신호)
  // 둘 다 아니면 → human-review (사용자가 수동 머지 가능, 또는 신호 추가 후 자동 재트라이지).
  if (input.isDraft && !input.lastCommitReady) {
    return {
      decision: 'human-review',
      reason:
        'PR draft 상태 — 작업 완료 시 draft 해제 또는 마지막 commit 에 `Cortex: ready` trailer 추가.',
    };
  }

  const blocker = input.flags.find((f) => BLOCKING_FLAGS.has(f));
  if (blocker) {
    return {
      decision: 'human-review',
      reason: blockerReason(blocker),
    };
  }

  // mergeable_state='blocked' (브랜치 보호·필수 리뷰 미충족·미해소 변경요청)은 GitHub 이 머지를
  // 막는 상태라, 자동 머지를 시도해도 405 로 거부되고 매 재트라이지마다 '머지 실패' 알림이 반복
  // 발사된다(리뷰 발견 — triage 는 'blocked' 를 안 봤지만 merge-gate 버튼은 차단해 둘이 불일치).
  // merge-gate(computeMergeGate)와 일관되게 human-review 로 — 사람이 보호규칙을 풀어야 머지 가능.
  if (input.mergeableState === 'blocked') {
    return {
      decision: 'human-review',
      reason: '브랜치 보호·필수 리뷰 등으로 머지가 차단된 상태입니다.',
    };
  }

  // mergeable_state='dirty' (머지 충돌). 충돌 자동 해결 토글이 켜져 있으면 auto-merge 흐름의
  // conflict-resolve(claude CLI)가 처리하므로 통과시킨다. 꺼져 있으면 머지 시도가 GitHub 에서
  // 거부되고(머지 불가) 매 재트라이지마다 '머지 실패' 알림이 반복 발사된다('blocked' 와 동일
  // 문제 — merge-gate 는 dirty 를 conflict 로 차단하나 triage 가 안 봐서 불일치였음). human-review 로.
  if (input.mergeableState === 'dirty' && !input.autoResolveConflictsEnabled) {
    return {
      decision: 'human-review',
      reason: '머지 충돌 — 사람 검토가 필요합니다.',
    };
  }

  if (input.testsPassed === false) {
    return {
      decision: 'human-review',
      reason: '테스트 실패 — 사람 검토가 필요합니다.',
    };
  }

  // CI 결과 미수신(null). 단 mergeable_state==='clean' 이면 CI 가 없는 레포 — GitHub 가
  // 머지 가능으로 판정했으므로 영원히 기다리지 않고 통과시킨다. clean 이 아니면(unstable=
  // CI 진행 중, unknown=계산 중 등) 기존대로 대기.
  if (input.testsPassed === null && input.mergeableState !== 'clean') {
    return {
      decision: 'human-review',
      // 인박스 한 줄 사유 — 짧게. 분석 직후엔 CI 가 끝나기 전이라 거의 항상 null 이라
      // 자연스러운 대기. 갱신은 check_run webhook 도착 시 일어남. 만약 GitHub 에 CI
      // 가 있는데도 영구 null 이면 App 의 Check run 이벤트 구독이 빠졌을 가능성 —
      // 진단 안내는 /settings 의 자동 머지 정책 섹션 desc 에 별도 노출.
      reason: 'CI 결과 대기 중 — 사람 검토가 필요합니다.',
    };
  }

  // 정책: "위험 아니면 다 자동 머지". 신뢰 점수 임계값 게이트는 제거 — 위험 플래그·CI 실패/대기·
  // 사람 작성·autoMerge off 만 차단하고, 그 외(신뢰 점수 무관)는 자동 머지. input.confidence 는
  // 더 이상 결정에 쓰지 않으나 UI/표시용으로 입력에 남겨둔다.
  return {
    decision: 'auto-merge',
    reason: '위험 신호 없음 — 자동 머지.',
  };
}

export type RunTriageResult =
  | { kind: 'decided'; decision: TriageDecision; reason: string }
  | {
      kind: 'skipped';
      reason: 'no-pr' | 'no-pre-review' | 'pr-closed' | 'pr-merged' | 'in-cluster' | 'muted';
    };

// PR 1건에 대해 triage_decisions 행을 생성/갱신하고 PR.status를 결정에 맞춰 업데이트.
// 호출 시점: webhook upsert 직후(sync.ts에서) 또는 Phase 4 PreReview 생성 직후.
// 멱등 — 같은 PR에 대해 여러 번 호출해도 안전 (최신 preReview 기준).
export async function runTriage(prId: number): Promise<RunTriageResult> {
  const pr = db.select().from(prs).where(eq(prs.id, prId)).get();
  if (!pr) return { kind: 'skipped', reason: 'no-pr' };
  if (pr.status === 'merged') return { kind: 'skipped', reason: 'pr-merged' };
  if (pr.status === 'closed') return { kind: 'skipped', reason: 'pr-closed' };
  if (pr.clusterId !== null) return { kind: 'skipped', reason: 'in-cluster' };

  const preReview = db
    .select()
    .from(preReviews)
    .where(and(eq(preReviews.prId, prId), eq(preReviews.headSha, pr.headSha)))
    .orderBy(desc(preReviews.analyzedAt))
    .get();

  if (!preReview) return { kind: 'skipped', reason: 'no-pre-review' };

  const project = db.select().from(projects).where(eq(projects.id, pr.repoId)).get();
  if (!project) return { kind: 'skipped', reason: 'no-pr' };

  // 뮤트 프로젝트는 "감지만, 관리 안 함" — 자동 머지 포함 어떤 트라이지 결정도 내리지 않는다.
  // sync 는 ingest 단에서 이미 뮤트를 거르지만, setProjectAutoMerge 재트라이지 등 다른 호출 경로는
  // 거르지 않으므로 여기서 중앙 가드(각 호출부 의존 대신 runTriage 가 불변식 보장). 뮤트 PR 은
  // 인박스에서도 제외되므로 status 변경 없이 skip.
  if (project.muted) return { kind: 'skipped', reason: 'muted' };

  // Readiness — draft 상태 + 마지막 commit trailer. GitHub 에서 fresh fetch (DB 안 저장 — 매번
  // 정확한 신호 보장). 기본값은 "ready" (= 차단 안 함) — installation 미설정/fetch 실패는 다른
  // 안전망(SHA 가드 등)이 있으니 readiness 만으로 영구 차단하지 않는다. 명확히 draft 인 PR 만 차단.
  //
  // readiness fetch 는 decideTriage 가 readiness 와 무관하게 human-review 로 떨어뜨리는 경우엔
  // 생략해 GitHub API 2회를 아낀다. **단 조건은 decideTriage 의 early-return 과 정확히 일치해야
  // 한다** — decideTriage 는 (1) 사람 작성, (2) autoMergeEnabled off 만 readiness 전에 early-return
  // 하고 **muted 는 체크하지 않는다**(뮤트는 sync/ingest 단에서 막음). 따라서 muted 를 조건에 넣어
  // skip 하면, setProjectAutoMerge 재트라이지처럼 muted+autoMerge-on 경로가 readiness 기본값(ready)
  // 으로 새어 draft PR 이 자동 머지될 수 있다(회귀). muted 는 조건에서 제외.
  let isDraft = false;
  let lastCommitReady = true;
  const readinessRelevant =
    project.installationId !== null && pr.authorKind === 'agent' && project.autoMergeEnabled;
  if (readinessRelevant) {
    const [owner, repo] = project.slug.split('/');
    try {
      const readiness = await getPRReadiness(project.installationId!, { owner, repo }, pr.number);
      isDraft = readiness.isDraft;
      lastCommitReady = isCortexReadyMarker(readiness.lastCommitMessage);
    } catch (err) {
      logger.error(
        { source: 'triage', op: 'getPRReadiness', prId, err },
        'PR readiness fetch 실패 — fail-open (다른 가드 동작)',
      );
    }
  }

  const result = decideTriage({
    authorKind: pr.authorKind,
    confidence: preReview.confidence,
    flags: preReview.flags,
    // testsPassed 는 PR.testsPassed 로 이동 (AI off 와 무관하게 CI 결과 채워짐).
    // preReview.testsPassed 는 legacy — 마이그레이션 0007 후엔 안 읽음.
    testsPassed: pr.testsPassed,
    // sync 가 webhook 처리 중 getPRMergeStatus 로 갱신해 둔 값. CI 없는 레포 식별에 사용.
    mergeableState: pr.mergeableState,
    autoMergeEnabled: project.autoMergeEnabled,
    isDraft,
    lastCommitReady,
    authorAssociation: pr.authorAssociation,
    autoResolveConflictsEnabled: project.autoResolveConflictsEnabled,
  });

  const existing = db
    .select({ id: triageDecisions.id })
    .from(triageDecisions)
    .where(eq(triageDecisions.prId, prId))
    .get();

  if (existing) {
    db.update(triageDecisions)
      .set({
        decision: result.decision,
        reason: result.reason,
        decidedBy: 'system',
        decidedAt: new Date(),
      })
      .where(eq(triageDecisions.id, existing.id))
      .run();
  } else {
    db.insert(triageDecisions)
      .values({
        prId,
        decision: result.decision,
        reason: result.reason,
        decidedBy: 'system',
      })
      .run();
  }

  // PR.status를 결정 결과에 맞춰 갱신.
  // auto-merge 결정은 'auto-mergeable' (auto-merge.ts가 실제 머지 호출). human-review는 'review-needed'.
  const newStatus = result.decision === 'auto-merge' ? 'auto-mergeable' : 'review-needed';
  if (pr.status !== newStatus) {
    db.update(prs).set({ status: newStatus, updatedAt: new Date() }).where(eq(prs.id, prId)).run();
  }

  return { kind: 'decided', decision: result.decision, reason: result.reason };
}

function blockerReason(flag: string): string {
  switch (flag) {
    case 'payment-domain':
      return '결제 도메인 변경 — 정책상 사람 검토가 필요합니다.';
    case 'auth-domain':
      return '인증 도메인 변경 — 정책상 사람 검토가 필요합니다.';
    case 'migration':
      return '마이그레이션 포함 — 사람 승인이 필수입니다.';
    case 'security-sensitive':
      return '보안 민감 영역 — 사람 검토가 필요합니다.';
    case 'external-api-new':
      return '신규 외부 API 호출 — 보안 검토를 권장합니다.';
    default:
      return `${flag} 위험 플래그 — 사람 검토가 필요합니다.`;
  }
}
