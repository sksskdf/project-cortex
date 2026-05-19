// Phase 5.4 — runTriage 가 'auto-merge' 로 결정한 PR 을 실제로 GitHub 에 머지.
// 호출 시점: sync.ts 안 runTriage 결과가 'decided' + 'auto-merge' 일 때.
// 실패 시 PR.status 를 'review-needed' 로 폴백, triage_decisions.reason 에도 사유 기록.

import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { prs, projects, triageDecisions } from '@/db/schema';
import { mergePR } from './github';

export type AutoMergeResult =
  | { kind: 'merged'; sha: string }
  | {
      kind: 'skipped';
      reason: 'no-pr' | 'no-project' | 'wrong-status' | 'no-decision' | 'not-auto-merge';
    }
  | { kind: 'failed'; reason: string };

// PR 1건에 대한 머지 시도. 호출자는 runTriage 결과 보고 시점을 정한다.
// 성공: PR.status='merged'. 실패/거부: PR.status='review-needed' + 사유 갱신.
export async function attemptAutoMerge(prId: number): Promise<AutoMergeResult> {
  const pr = db.select().from(prs).where(eq(prs.id, prId)).get();
  if (!pr) return { kind: 'skipped', reason: 'no-pr' };

  // runTriage 가 'auto-mergeable' 로 표시한 PR 만 실제 머지.
  // 이미 머지/닫힘이면 멱등 skip.
  if (pr.status !== 'auto-mergeable') return { kind: 'skipped', reason: 'wrong-status' };

  const decision = db.select().from(triageDecisions).where(eq(triageDecisions.prId, prId)).get();
  if (!decision) return { kind: 'skipped', reason: 'no-decision' };
  if (decision.decision !== 'auto-merge') return { kind: 'skipped', reason: 'not-auto-merge' };

  const project = db.select().from(projects).where(eq(projects.id, pr.repoId)).get();
  if (!project) return { kind: 'skipped', reason: 'no-project' };

  // slug 가 'owner/repo' 형식이라 가정. 단일 토큰 형식은 owner=slug, repo=undefined →
  // Octokit 호출이 422로 떨어지고 폴백 흐름 탐. Phase 3.4 의 credentials/owner 모델로 정리.
  const [owner, repo] = project.slug.split('/');

  try {
    const result = await mergePR({ owner, repo }, pr.number, {
      method: 'squash',
      commitTitle: pr.title,
    });
    if (!result.merged) {
      return revertToReviewNeeded(prId, 'GitHub 머지 거부 — merged=false 반환.');
    }
    db.update(prs).set({ status: 'merged', updatedAt: new Date() }).where(eq(prs.id, prId)).run();
    return { kind: 'merged', sha: result.sha };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return revertToReviewNeeded(prId, `GitHub 머지 실패: ${message}`);
  }
}

// 머지 실패 시 사람 검토로 되돌림 — triage_decisions.reason 갱신해서 UI 에 사유 노출.
function revertToReviewNeeded(prId: number, reason: string): AutoMergeResult {
  db.update(prs)
    .set({ status: 'review-needed', updatedAt: new Date() })
    .where(eq(prs.id, prId))
    .run();
  db.update(triageDecisions)
    .set({ decision: 'human-review', reason, decidedBy: 'system', decidedAt: new Date() })
    .where(eq(triageDecisions.prId, prId))
    .run();
  return { kind: 'failed', reason };
}
