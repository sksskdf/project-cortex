import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { prs, projects, type PRRecord } from '@/db/schema';
import { attemptAutoMerge } from './auto-merge';
import { tryClusterPR } from './clustering';
import { attemptConflictResolution } from './conflict-resolve';
import { getPRMergeStatus, listCheckRunsForRef } from './github';
import { logger } from './logger';
import { createNotification, isRevertPR } from './notifications';
import { analyzePR } from './pre-review';
import { matchAndApplyDoneFromPR } from './roadmap';
import { getSettings } from './settings';
import { attemptTestFix } from './test-fix';
import { runTriage } from './triage';

// 외부 GitHub webhook 페이로드를 lib/github의 분류 결과로 정규화한 입력.
// 실제 webhook → 이 shape 변환은 webhook 라우트(다음 PR)에서.
export type WebhookPRAction = 'opened' | 'closed' | 'reopened' | 'synchronize' | 'edited';

export type WebhookPRPayload = {
  action: WebhookPRAction;
  repoSlug: string;
  // GitHub App webhook 은 항상 함께 보냄. legacy PAT webhook 은 null 가능.
  installationId: number | null;
  pr: {
    number: number;
    title: string;
    // GitHub PR description. webhook payload 의 pull_request.body — null 가능.
    body: string | null;
    headSha: string;
    additions: number;
    deletions: number;
    filesChanged: number;
    merged: boolean;
    authorLogin: string;
    authorKind: 'agent' | 'human';
    createdAt: Date;
    updatedAt: Date;
  };
};

export type SyncResult =
  | { kind: 'inserted'; prId: number }
  | { kind: 'updated'; prId: number }
  | { kind: 'skipped'; reason: 'unknown-repo' | 'no-op' | 'muted' };

type PRStatus = PRRecord['status'];

function computeStatus(action: WebhookPRAction, merged: boolean): PRStatus {
  if (action === 'closed') return merged ? 'merged' : 'closed';
  if (action === 'opened' || action === 'reopened') return 'open';
  // synchronize / edited — 기존 상태 유지가 이상적이지만 application-level 결정.
  // 호출부가 status를 직접 결정하도록 'open' 디폴트.
  return 'open';
}

// 분석이 의미 있는 action 만 — closed / edited 는 diff 가 그대로거나 끝났으므로 skip.
// (edited 는 GitHub 에서 제목·본문만 바뀐 경우. diff 변경 없음.)
function shouldAnalyze(action: WebhookPRAction): boolean {
  return action === 'opened' || action === 'reopened' || action === 'synchronize';
}

// AI 사전 리뷰 적용 여부 — 전역 토글(settings.aiEnabled) AND 프로젝트별 토글(aiReviewEnabled).
// 둘 중 하나라도 OFF 면 분석/클러스터링을 건너뛴다. 프로젝트가 없으면(이론상 도달X) 기본 허용.
function isAiEnabledForPr(prId: number): boolean {
  if (!getSettings().aiEnabled) return false;
  const row = db
    .select({ aiReviewEnabled: projects.aiReviewEnabled })
    .from(prs)
    .innerJoin(projects, eq(prs.repoId, projects.id))
    .where(eq(prs.id, prId))
    .get();
  return row?.aiReviewEnabled ?? true;
}

// Anthropic 호출 실패가 sync 자체를 막지 않게 try/catch.
// 실패 시 preReview 가 없으므로 runTriage 가 'no-pre-review' 로 skip — 안전한 폴백.
// Phase 7 에서 백그라운드 큐로 분리되면 sync 응답 시간 안정화.
// AI 토글(전역 또는 프로젝트) OFF 면 호출 자체를 건너뛰어 크레딧 사용 0.
async function safeAnalyze(prId: number): Promise<void> {
  if (!isAiEnabledForPr(prId)) return;
  try {
    await analyzePR(prId);
  } catch (err) {
    logger.error({ source: 'sync', op: 'analyzePR', prId, err }, 'analyzePR failed');
    // 분석 실패(LLM/claude CLI 오류 등) 는 preReview 없이 조용히 묻혀 사용자가 실패인지
    // 대기인지 구분 못 함 — 전용 알림 kind 가 없어 'auto-merge-failed' 재사용 (다른 자동
    // 수정 흐름과 동일 패턴). PR.status 는 호출부에서 review-needed 로 폴백.
    safeNotify({
      kind: 'auto-merge-failed',
      prId,
      reason: 'AI 사전 리뷰 분석 실패 — 사람이 직접 검토해 주세요.',
    });
  }
}

// runTriage 결과가 auto-merge 면 즉시 머지 시도. 실패해도 sync 응답은 정상,
// PR.status 가 review-needed 로 폴백되므로 인박스에 등장.
async function safeAutoMerge(prId: number): Promise<void> {
  try {
    await attemptAutoMerge(prId);
  } catch (err) {
    logger.error(
      { source: 'sync', op: 'attemptAutoMerge', prId, err },
      'attemptAutoMerge unexpected error',
    );
  }
}

// 자동 머지를 안 타는 review-needed PR(사람 PR·플래그 차단·미분석)도 토글 ON·dirty 면 충돌 자동
// 해결. (자동 머지 PR 은 auto-merge.ts 가 머지 직전에 이미 처리하므로 여기선 비-자동머지 경로만.)
// best-effort 백그라운드 — git/claude 작업이 수 분 걸릴 수 있어 webhook 응답을 막지 않는다.
// 토글 OFF·not-dirty·fork 면 attemptConflictResolution 이 즉시 skip (작성자 무관).
function safeResolveConflicts(prId: number): void {
  attemptConflictResolution(prId).catch((err) => {
    logger.error(
      { source: 'sync', op: 'attemptConflictResolution', prId, err },
      'attemptConflictResolution unexpected error',
    );
  });
}

// GitHub mergeable_state 를 PR 에 저장 — runTriage(CI 없는 레포 식별) + 인박스 행
// 머지 게이팅(충돌/차단 사유)에 사용. runTriage 직전에 호출해 신선한 값으로 판정한다.
// best-effort — 실패해도(예: GitHub 일시 오류) mergeableState 는 갱신 안 되고 흐름은 계속.
// reconcile 대량 동기화 때는 호출하지 않는다(행마다 API 호출 회피) — webhook 경로 전용.
async function safeStoreMergeState(
  prId: number,
  installationId: number,
  slug: string,
  number: number,
): Promise<void> {
  try {
    const [owner, repo] = slug.split('/');
    const status = await getPRMergeStatus(installationId, { owner, repo }, number);
    db.update(prs).set({ mergeableState: status.mergeableState }).where(eq(prs.id, prId)).run();
  } catch (err) {
    logger.error(
      { source: 'sync', op: 'getPRMergeStatus', prId, err },
      'mergeable_state 갱신 실패 (무시하고 계속)',
    );
  }
}

// PR 머지 시점에 body 의 'Closes #PHASE-<key>' / 'Closes #ITEM-<id>' 매칭으로
// 로드맵 item 들을 자동 done + doneByPrId 채움. cascade 동작은 lib/roadmap.ts.
// 실패해도 sync 응답에 영향 없음 (로드맵 매칭은 보조 기능).
function safeRoadmapMatch(prId: number): void {
  try {
    matchAndApplyDoneFromPR(prId);
  } catch (err) {
    logger.error(
      { source: 'sync', op: 'matchAndApplyDoneFromPR', prId, err },
      'matchAndApplyDoneFromPR failed',
    );
  }
}

// human-review 결정 PR 에 대해 클러스터링 시도. clusterId 가 부여되면 인박스에서
// 사라지고 클러스터 화면에 묶임. 실패해도 sync 응답에 영향 없음.
// AI off 면 preReview.changedPaths 가 없어 자카드 계산 무의미 — skip.
async function safeTryCluster(prId: number): Promise<void> {
  if (!isAiEnabledForPr(prId)) return;
  try {
    await tryClusterPR(prId);
  } catch (err) {
    logger.error(
      { source: 'sync', op: 'tryClusterPR', prId, err },
      'tryClusterPR unexpected error',
    );
  }
}

// reconcile 흐름 (수동 동기화) 은 AI 분석 명시 bypass — 크레딧 0. webhook 흐름은
// 기본 동작 (analyzePR + triage + autoMerge) 유지.
export type SyncSource = 'webhook' | 'reconcile';

export async function handlePullRequestWebhook(
  payload: WebhookPRPayload,
  source: SyncSource = 'webhook',
): Promise<SyncResult> {
  let project = db
    .select({ id: projects.id, installationId: projects.installationId })
    .from(projects)
    .where(eq(projects.slug, payload.repoSlug))
    .get();

  // 자동 onboard — App 이 새 레포에 설치되면 첫 webhook 으로 projects 행 자동 생성.
  // installationId 가 있을 때만 (PAT/legacy 페이로드는 unknown-repo 폴백).
  // autoMergeEnabled=false + muted=true 디폴트 — 조직 레포에 App 을 설치하면 남의 PR 이
  // 인박스를 어지럽히므로, 감지만 하고 관리는 끈 상태로 시작한다. /projects 에서 '관리 시작'.
  if (!project && payload.installationId !== null) {
    const inserted = db
      .insert(projects)
      .values({
        slug: payload.repoSlug,
        name: payload.repoSlug,
        installationId: payload.installationId,
        autoMergeEnabled: false,
        muted: true,
      })
      .returning({ id: projects.id, installationId: projects.installationId })
      .get();
    project = inserted;
  } else if (
    project &&
    project.installationId !== payload.installationId &&
    payload.installationId !== null
  ) {
    // installation 재설치 등으로 id 바뀌면 갱신.
    db.update(projects)
      .set({ installationId: payload.installationId })
      .where(eq(projects.id, project.id))
      .run();
    project = { id: project.id, installationId: payload.installationId };
  }

  if (!project) {
    return { kind: 'skipped', reason: 'unknown-repo' };
  }

  // 뮤트된 프로젝트는 webhook 무시 — 인박스 ingest·분석·트라이아지·자동머지 차단.
  // 자동 onboard 로 방금 만든 프로젝트(muted=true)도 여기서 바로 빠진다 (행은 생성돼 /projects 에 노출).
  const muteRow = db
    .select({ muted: projects.muted })
    .from(projects)
    .where(eq(projects.id, project.id))
    .get();
  if (muteRow?.muted) return { kind: 'skipped', reason: 'muted' };

  const existing = db
    .select({ id: prs.id, status: prs.status, headSha: prs.headSha })
    .from(prs)
    .where(and(eq(prs.repoId, project.id), eq(prs.number, payload.pr.number)))
    .get();

  const values = {
    repoId: project.id,
    number: payload.pr.number,
    title: payload.pr.title,
    body: payload.pr.body,
    authorKind: payload.pr.authorKind,
    authorId: payload.pr.authorLogin,
    headSha: payload.pr.headSha,
    linesAdded: payload.pr.additions,
    linesRemoved: payload.pr.deletions,
    filesChanged: payload.pr.filesChanged,
    createdAt: payload.pr.createdAt,
    updatedAt: payload.pr.updatedAt,
  };

  if (!existing) {
    const inserted = db
      .insert(prs)
      .values({ ...values, status: computeStatus(payload.action, payload.pr.merged) })
      .returning({ id: prs.id })
      .get();
    // 새 PR 의 title/body 가 GitHub revert UI 패턴이면 알림 — 사용자가 머지된 변경이
    // 되돌려졌음을 즉시 알 수 있게. reconcile 흐름에선 과거 PR 까지 모두 알림 폭탄이 될 수
    // 있어 webhook 진입만.
    if (source === 'webhook' && isRevertPR({ title: values.title, body: values.body })) {
      safeNotify({ kind: 'revert-detected', prId: inserted.id });
    }
    // 새 PR — opened/reopened 면 즉시 분석. 분석 결과(preReview)가 있어야 runTriage 가 결정.
    // 단 reconcile 흐름은 의도적 bypass — Anthropic 크레딧 0 (사용자가 명시 요청 시만 분석).
    if (shouldAnalyze(payload.action) && source !== 'reconcile') {
      await safeAnalyze(inserted.id);
    }
    // 분석 직후 mergeable_state 저장 — GitHub 가 그새 머지 가능성을 계산해 둠. CI 없는
    // 레포면 'clean' 이라 runTriage 가 영원히 CI 를 기다리지 않고 자동 머지로 진행.
    if (source === 'webhook' && project.installationId !== null) {
      await safeStoreMergeState(
        inserted.id,
        project.installationId,
        payload.repoSlug,
        payload.pr.number,
      );
    }
    const triage = await runTriage(inserted.id);
    if (triage.kind === 'decided' && triage.decision === 'auto-merge') {
      await safeAutoMerge(inserted.id);
    } else if (triage.kind === 'decided' && triage.decision === 'human-review') {
      // Phase 6 — 같은 작성자 · 같은 레포 24h 내 유사도 0.85+ PR 3건 모이면 자동 클러스터.
      await safeTryCluster(inserted.id);
      // 사람 검토 대상이라도 dirty 면 충돌 자동 해결(토글 ON) — 사람이 충돌 없는 PR 을 검토.
      safeResolveConflicts(inserted.id);
    } else if (triage.kind === 'skipped' && triage.reason === 'no-pre-review') {
      // 분석 실패(LLM 오류·API key 누락·rate limit 등) → preReview 없음 → triage skip.
      // status 가 'open' 으로 남으면 인박스 쿼리(review-needed)에 안 잡혀 사용자 시야에서 사라짐.
      // 안전 폴백: review-needed 로 띄워서 사람이 처리 가능하게.
      db.update(prs)
        .set({ status: 'review-needed', updatedAt: new Date() })
        .where(eq(prs.id, inserted.id))
        .run();
      safeResolveConflicts(inserted.id);
    }
    // 새 PR 인데 첫 webhook 이 closed+merged 일 수 있음 (reconcile/늦은 수신).
    // body 의 Closes 마커가 있으면 로드맵 매칭 발화.
    if (payload.action === 'closed' && payload.pr.merged) {
      safeRoadmapMatch(inserted.id);
    }
    return { kind: 'inserted', prId: inserted.id };
  }

  // 기존 PR — synchronize/edited는 상태 보존, opened/closed/reopened는 갱신.
  const newStatus: PRStatus =
    payload.action === 'synchronize' || payload.action === 'edited'
      ? existing.status
      : computeStatus(payload.action, payload.pr.merged);

  db.update(prs)
    .set({
      title: values.title,
      body: values.body,
      headSha: values.headSha,
      linesAdded: values.linesAdded,
      linesRemoved: values.linesRemoved,
      filesChanged: values.filesChanged,
      status: newStatus,
      updatedAt: values.updatedAt,
    })
    .where(eq(prs.id, existing.id))
    .run();

  // synchronize 면 새 headSha 기준으로 재분석 필요 — analyzePR 의 (prId, headSha)
  // 캐시가 자동으로 새 행을 만든다. opened/reopened 도 마찬가지 (이미 PR 이 있을 때 재오픈).
  // reconcile 은 분석 bypass.
  if (shouldAnalyze(payload.action) && source !== 'reconcile') {
    await safeAnalyze(existing.id);
  }
  if (source === 'webhook' && project.installationId !== null) {
    await safeStoreMergeState(
      existing.id,
      project.installationId,
      payload.repoSlug,
      payload.pr.number,
    );
  }
  // closed/merged면 runTriage가 status로 skip — 안전.
  const triage = await runTriage(existing.id);
  if (triage.kind === 'decided' && triage.decision === 'auto-merge') {
    await safeAutoMerge(existing.id);
  } else if (triage.kind === 'decided' && triage.decision === 'human-review') {
    await safeTryCluster(existing.id);
    // 사람 검토 대상이라도 dirty 면 충돌 자동 해결(토글 ON). synchronize 마다 재시도되나
    // 해결 후엔 not-dirty 라 즉시 skip — 루프 없음.
    safeResolveConflicts(existing.id);
  } else if (
    triage.kind === 'skipped' &&
    triage.reason === 'no-pre-review' &&
    shouldAnalyze(payload.action)
  ) {
    // 분석은 시도했지만 실패 — 새 PR 분기와 동일하게 review-needed 로 폴백.
    // closed/edited 면 shouldAnalyze=false 라 이 분기 안 탐 (이미 끝났거나 diff 변경 없음).
    db.update(prs)
      .set({ status: 'review-needed', updatedAt: new Date() })
      .where(eq(prs.id, existing.id))
      .run();
    safeResolveConflicts(existing.id);
  }

  // 머지 시점에만 로드맵 매칭 발화. open/synchronize 등은 body 변경돼도 미발화 (확정 시점만).
  // 같은 PR 의 재발화는 lib/roadmap.ts cascade 의 `doneByPrId IS NULL` 가드로 idempotent.
  if (payload.action === 'closed' && payload.pr.merged) {
    safeRoadmapMatch(existing.id);
  }

  return { kind: 'updated', prId: existing.id };
}

// check_run · check_suite webhook 처리. CI 결과가 완료 (completed) 일 때만 호출.
// head_sha 로 매칭되는 PR 의 최신 preReview 의 testsPassed 를 갱신하고,
// 그 결과로 자동 머지가 가능해지면 (passed + 다른 조건 충족) 재트라이아지 + 자동 머지 시도.
export type CheckSyncResult =
  | { kind: 'updated'; prId: number; testsPassed: boolean | null }
  | { kind: 'skipped'; reason: 'unknown-repo' | 'no-pr' | 'no-installation' | 'muted' };

export async function handleCheckWebhook(payload: {
  repoSlug: string;
  installationId: number | null;
  headSha: string;
}): Promise<CheckSyncResult> {
  const project = db
    .select({
      id: projects.id,
      installationId: projects.installationId,
      slug: projects.slug,
      muted: projects.muted,
    })
    .from(projects)
    .where(eq(projects.slug, payload.repoSlug))
    .get();
  if (!project) return { kind: 'skipped', reason: 'unknown-repo' };
  // 뮤트된 프로젝트는 CI 결과도 무시 (관리 차단).
  if (project.muted) return { kind: 'skipped', reason: 'muted' };

  // head_sha 가 같은 PR 을 찾는다. 같은 SHA 의 PR 이 여러 개일 가능성은 거의 없음 (다른
  // 브랜치에서 cherry-pick 했어도 squash 머지로 SHA 가 달라짐). 최신 1개 매칭.
  const pr = db
    .select({ id: prs.id, number: prs.number })
    .from(prs)
    .where(and(eq(prs.repoId, project.id), eq(prs.headSha, payload.headSha)))
    .orderBy(desc(prs.updatedAt))
    .get();
  if (!pr) return { kind: 'skipped', reason: 'no-pr' };

  const installationId = project.installationId ?? payload.installationId;
  if (installationId === null) return { kind: 'skipped', reason: 'no-installation' };

  const [owner, repo] = project.slug.split('/');
  const summary = await listCheckRunsForRef(installationId, { owner, repo }, payload.headSha);
  const testsPassed: boolean | null =
    summary.status === 'passed' ? true : summary.status === 'failed' ? false : null;

  // 이전 testsPassed 값 확인 — false → false 같은 멱등 update 시 알림 폭탄 방지.
  const prevTestsPassed = db
    .select({ testsPassed: prs.testsPassed })
    .from(prs)
    .where(eq(prs.id, pr.id))
    .get();

  // CI 결과는 prs 컬럼에 직접 저장 — AI 분석 (preReview) 없이도 채워짐. AI off
  // 시에도 자동 머지 룰 #4 가 prs.testsPassed 를 읽으므로 정상 동작.
  db.update(prs).set({ testsPassed }).where(eq(prs.id, pr.id)).run();

  // CI 완료로 mergeable_state 가 바뀌었을 수 있음 (unstable→clean 등) — 인박스 행 머지
  // 게이팅·재트라이아지가 신선한 값을 쓰도록 갱신.
  await safeStoreMergeState(pr.id, installationId, project.slug, pr.number);

  // CI 실패가 처음 감지된 시점에만 알림 — 같은 PR 에 여러 check_run 이 완료될 때 중복 방지.
  if (testsPassed === false && prevTestsPassed?.testsPassed !== false) {
    safeNotify({ kind: 'ci-failed', prId: pr.id });
    // 자동 테스트 수정 시도 (토글 ON·agent PR 만). 백그라운드 실행 — claude 가 테스트를
    // 돌리고 고치는 데 수 분 걸릴 수 있어 webhook 응답을 막지 않는다. 토글 OFF(디폴트)면 즉시 skip.
    safeAutoFixTests(pr.id);
  }

  // 결과가 true 가 되면 자동 머지 후보가 됐을 수 있음 — 재트라이아지 + 시도.
  // 다른 조건 (confidence·flags) 은 runTriage 가 다시 평가하므로 안전.
  if (testsPassed === true) {
    const triage = await runTriage(pr.id);
    if (triage.kind === 'decided' && triage.decision === 'auto-merge') {
      await safeAutoMerge(pr.id);
    }
  }

  return { kind: 'updated', prId: pr.id, testsPassed };
}

function safeNotify(input: Parameters<typeof createNotification>[0]): void {
  try {
    createNotification(input);
  } catch (err) {
    logger.error(
      { source: 'sync', op: 'createNotification', kind: input.kind, err },
      'createNotification failed',
    );
  }
}

// CI 실패 시 자동 테스트 수정 — best-effort 백그라운드. 토글 OFF(디폴트)면 attemptTestFix
// 가 즉시 skip 하므로 비용 0. 성공 시 push 가 새 CI 를 발사해 재트라이아지+머지로 이어짐.
function safeAutoFixTests(prId: number): void {
  attemptTestFix(prId).catch((err) => {
    logger.error(
      { source: 'sync', op: 'attemptTestFix', prId, err },
      'attemptTestFix unexpected error',
    );
  });
}
