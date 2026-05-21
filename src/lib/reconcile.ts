// 다운타임 회복 — GitHub 의 등록된 레포의 open PR 들을 일괄 fetch 해서
// handlePullRequestWebhook 와 같은 upsert 로직 (멱등) 으로 처리.
// 변경된 점: source='reconcile' 옵션으로 호출 → safeAnalyze · safeTryCluster skip
// (Anthropic 크레딧 0). PR 상세 진입 시 사용자가 명시 요청해야 AI 분석 발화.

import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { projects } from '@/db/schema';
import { classifyAuthor, listOpenPullRequests, type PRListItem } from './github';
import { handlePullRequestWebhook, type SyncResult, type WebhookPRPayload } from './sync';

export type ReconcileResult =
  | {
      kind: 'reconciled';
      projectId: number;
      slug: string;
      total: number;
      inserted: number;
      updated: number;
      skipped: number;
      failed: number;
    }
  | { kind: 'skipped'; reason: 'no-project' | 'no-installation' }
  | { kind: 'failed'; reason: string };

export async function reconcileProject(projectId: number): Promise<ReconcileResult> {
  const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!project) return { kind: 'skipped', reason: 'no-project' };
  if (project.installationId === null) return { kind: 'skipped', reason: 'no-installation' };

  const [owner, repo] = project.slug.split('/');
  let prs: PRListItem[];
  try {
    prs = await listOpenPullRequests(project.installationId, { owner, repo });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { kind: 'failed', reason: `GitHub PR 목록 fetch 실패: ${message}` };
  }

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const pr of prs) {
    const payload: WebhookPRPayload = {
      action: 'opened', // upsert 로직이 status 결정 — 이미 있으면 updated.
      repoSlug: project.slug,
      installationId: project.installationId,
      pr: {
        number: pr.number,
        title: pr.title,
        body: pr.body,
        headSha: pr.headSha,
        additions: pr.additions,
        deletions: pr.deletions,
        filesChanged: pr.changedFiles,
        merged: false,
        authorLogin: pr.authorLogin,
        authorKind: classifyAuthor(pr.authorLogin, pr.authorType, pr.authorBody),
        createdAt: pr.createdAt,
        updatedAt: pr.updatedAt,
      },
    };

    let result: SyncResult;
    try {
      result = await handlePullRequestWebhook(payload, 'reconcile');
    } catch (err) {
      console.error(`reconcile PR upsert 실패 (#${pr.number}):`, err);
      failed += 1;
      continue;
    }

    if (result.kind === 'inserted') inserted += 1;
    else if (result.kind === 'updated') updated += 1;
    else skipped += 1;
  }

  return {
    kind: 'reconciled',
    projectId: project.id,
    slug: project.slug,
    total: prs.length,
    inserted,
    updated,
    skipped,
    failed,
  };
}
