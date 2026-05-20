import { and, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { prs, projects, type PRRecord } from '@/db/schema';
import { attemptAutoMerge } from './auto-merge';
import { tryClusterPR } from './clustering';
import { analyzePR } from './pre-review';
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
async function safeAnalyze(prId: number): Promise<void> {
  try {
    await analyzePR(prId);
  } catch (err) {
    console.error(`analyzePR failed for PR ${prId}:`, err);
  }
}

// runTriage 결과가 auto-merge 면 즉시 머지 시도. 실패해도 sync 응답은 정상,
// PR.status 가 review-needed 로 폴백되므로 인박스에 등장.
async function safeAutoMerge(prId: number): Promise<void> {
  try {
    await attemptAutoMerge(prId);
  } catch (err) {
    console.error(`attemptAutoMerge unexpected error for PR ${prId}:`, err);
  }
}

// human-review 결정 PR 에 대해 클러스터링 시도. clusterId 가 부여되면 인박스에서
// 사라지고 클러스터 화면에 묶임. 실패해도 sync 응답에 영향 없음.
async function safeTryCluster(prId: number): Promise<void> {
  try {
    await tryClusterPR(prId);
  } catch (err) {
    console.error(`tryClusterPR unexpected error for PR ${prId}:`, err);
  }
}

export async function handlePullRequestWebhook(payload: WebhookPRPayload): Promise<SyncResult> {
  let project = db
    .select({ id: projects.id, installationId: projects.installationId })
    .from(projects)
    .where(eq(projects.slug, payload.repoSlug))
    .get();

  // 자동 onboard — App 이 새 레포에 설치되면 첫 webhook 으로 projects 행 자동 생성.
  // installationId 가 있을 때만 (PAT/legacy 페이로드는 unknown-repo 폴백).
  if (!project && payload.installationId !== null) {
    const inserted = db
      .insert(projects)
      .values({
        slug: payload.repoSlug,
        name: payload.repoSlug,
        installationId: payload.installationId,
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
    // 새 PR — opened/reopened 면 즉시 분석. 분석 결과(preReview)가 있어야 runTriage 가 결정.
    if (shouldAnalyze(payload.action)) {
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
  if (shouldAnalyze(payload.action)) {
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

  return { kind: 'updated', prId: existing.id };
}
