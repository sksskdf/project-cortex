import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { prs, projects, type PRRecord } from '@/db/schema';
import { attemptAutoMerge } from './auto-merge';
import { tryClusterPR } from './clustering';
import { listCheckRunsForRef } from './github';
import { logger } from './logger';
import { createNotification, isRevertPR } from './notifications';
import { analyzePR } from './pre-review';
import { matchAndApplyDoneFromPR } from './roadmap';
import { getSettings } from './settings';
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
  | { kind: 'skipped'; reason: 'unknown-repo' | 'no-op' };

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

// Anthropic 호출 실패가 sync 자체를 막지 않게 try/catch.
// 실패 시 preReview 가 없으므로 runTriage 가 'no-pre-review' 로 skip — 안전한 폴백.
// Phase 7 에서 백그라운드 큐로 분리되면 sync 응답 시간 안정화.
// settings.aiEnabled=false 면 호출 자체를 건너뛰어 Anthropic 크레딧 사용 0.
async function safeAnalyze(prId: number): Promise<void> {
  if (!getSettings().aiEnabled) return;
  try {
    await analyzePR(prId);
  } catch (err) {
    logger.error({ source: 'sync', op: 'analyzePR', prId, err }, 'analyzePR failed');
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
  if (!getSettings().aiEnabled) return;
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
  // autoMergeEnabled=true 디폴트 — App 설치 자체가 자동화 의지의 표명. 끄려면
  // /settings 또는 SQL 로 명시 (Phase 8 의 인테이크 마법사에서 첫 화면에 토글 노출 예정).
  if (!project && payload.installationId !== null) {
    const inserted = db
      .insert(projects)
      .values({
        slug: payload.repoSlug,
        name: payload.repoSlug,
        installationId: payload.installationId,
        autoMergeEnabled: true,
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
    const triage = await runTriage(inserted.id);
    if (triage.kind === 'decided' && triage.decision === 'auto-merge') {
      await safeAutoMerge(inserted.id);
    } else if (triage.kind === 'decided' && triage.decision === 'human-review') {
      // Phase 6 — 같은 작성자 · 같은 레포 24h 내 유사도 0.85+ PR 3건 모이면 자동 클러스터.
      await safeTryCluster(inserted.id);
    } else if (triage.kind === 'skipped' && triage.reason === 'no-pre-review') {
      // 분석 실패(LLM 오류·API key 누락·rate limit 등) → preReview 없음 → triage skip.
      // status 가 'open' 으로 남으면 인박스 쿼리(review-needed)에 안 잡혀 사용자 시야에서 사라짐.
      // 안전 폴백: review-needed 로 띄워서 사람이 처리 가능하게.
      db.update(prs)
        .set({ status: 'review-needed', updatedAt: new Date() })
        .where(eq(prs.id, inserted.id))
        .run();
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
  // closed/merged면 runTriage가 status로 skip — 안전.
  const triage = await runTriage(existing.id);
  if (triage.kind === 'decided' && triage.decision === 'auto-merge') {
    await safeAutoMerge(existing.id);
  } else if (triage.kind === 'decided' && triage.decision === 'human-review') {
    await safeTryCluster(existing.id);
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
  | { kind: 'skipped'; reason: 'unknown-repo' | 'no-pr' | 'no-installation' };

export async function handleCheckWebhook(payload: {
  repoSlug: string;
  installationId: number | null;
  headSha: string;
}): Promise<CheckSyncResult> {
  const project = db
    .select({ id: projects.id, installationId: projects.installationId, slug: projects.slug })
    .from(projects)
    .where(eq(projects.slug, payload.repoSlug))
    .get();
  if (!project) return { kind: 'skipped', reason: 'unknown-repo' };

  // head_sha 가 같은 PR 을 찾는다. 같은 SHA 의 PR 이 여러 개일 가능성은 거의 없음 (다른
  // 브랜치에서 cherry-pick 했어도 squash 머지로 SHA 가 달라짐). 최신 1개 매칭.
  const pr = db
    .select({ id: prs.id })
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

  // CI 실패가 처음 감지된 시점에만 알림 — 같은 PR 에 여러 check_run 이 완료될 때 중복 방지.
  if (testsPassed === false && prevTestsPassed?.testsPassed !== false) {
    safeNotify({ kind: 'ci-failed', prId: pr.id });
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
