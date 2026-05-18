import { and, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { prs, projects, type PRRecord } from '@/db/schema';
import { runTriage } from './triage';

// 외부 GitHub webhook 페이로드를 lib/github의 분류 결과로 정규화한 입력.
// 실제 webhook → 이 shape 변환은 webhook 라우트(다음 PR)에서.
export type WebhookPRAction = 'opened' | 'closed' | 'reopened' | 'synchronize' | 'edited';

export type WebhookPRPayload = {
  action: WebhookPRAction;
  repoSlug: string;
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

export async function handlePullRequestWebhook(payload: WebhookPRPayload): Promise<SyncResult> {
  const project = db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, payload.repoSlug))
    .get();

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
    // PreReview가 이미 있으면(예: 재처리) 트라이아지도 즉시. 없으면 runTriage가 skip.
    await runTriage(inserted.id);
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

  // synchronize/edited 후 새 headSha에 대한 PreReview가 있으면 다시 트라이아지.
  // closed/merged면 runTriage가 status로 skip — 안전.
  await runTriage(existing.id);

  return { kind: 'updated', prId: existing.id };
}
