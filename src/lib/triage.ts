// 트라이아지 결정 — DOMAIN.md §4 자동 머지 정책의 한 곳 구현.
// decideTriage는 pure. runTriage는 DB read/write.

import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { preReviews, prs, projects, triageDecisions } from '@/db/schema';
import type { TriageDecisionRow } from '@/db/schema';
import { AUTO_MERGE_THRESHOLD } from './confidence';

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
  autoMergeEnabled: boolean;
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

  if (!input.autoMergeEnabled) {
    return {
      decision: 'human-review',
      reason: '레포의 자동 머지 정책이 꺼져 있습니다.',
    };
  }

  const blocker = input.flags.find((f) => BLOCKING_FLAGS.has(f));
  if (blocker) {
    return {
      decision: 'human-review',
      reason: blockerReason(blocker),
    };
  }

  if (input.testsPassed === false) {
    return {
      decision: 'human-review',
      reason: '테스트 실패 — 사람 검토가 필요합니다.',
    };
  }

  if (input.testsPassed === null) {
    return {
      decision: 'human-review',
      // 인박스 한 줄 사유 — 짧게. 분석 직후엔 CI 가 끝나기 전이라 거의 항상 null 이라
      // 자연스러운 대기. 갱신은 check_run webhook 도착 시 일어남. 만약 GitHub 에 CI
      // 가 있는데도 영구 null 이면 App 의 Check run 이벤트 구독이 빠졌을 가능성 —
      // 진단 안내는 /settings 의 자동 머지 정책 섹션 desc 에 별도 노출.
      reason: 'CI 결과 대기 중 — 사람 검토가 필요합니다.',
    };
  }

  if (input.confidence < AUTO_MERGE_THRESHOLD) {
    return {
      decision: 'human-review',
      reason: `신뢰 점수 ${input.confidence}점으로 자동 머지 기준(${AUTO_MERGE_THRESHOLD}+) 미달.`,
    };
  }

  return {
    decision: 'auto-merge',
    reason: '모든 자동 머지 조건 충족.',
  };
}

export type RunTriageResult =
  | { kind: 'decided'; decision: TriageDecision; reason: string }
  | {
      kind: 'skipped';
      reason: 'no-pr' | 'no-pre-review' | 'pr-closed' | 'pr-merged' | 'in-cluster';
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

  const result = decideTriage({
    authorKind: pr.authorKind,
    confidence: preReview.confidence,
    flags: preReview.flags,
    // testsPassed 는 PR.testsPassed 로 이동 (AI off 와 무관하게 CI 결과 채워짐).
    // preReview.testsPassed 는 legacy — 마이그레이션 0007 후엔 안 읽음.
    testsPassed: pr.testsPassed,
    autoMergeEnabled: project.autoMergeEnabled,
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
