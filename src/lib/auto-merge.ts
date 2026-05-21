// Phase 5.4 — runTriage 가 'auto-merge' 로 결정한 PR 을 실제로 GitHub 에 머지.
// 호출 시점: sync.ts 안 runTriage 결과가 'decided' + 'auto-merge' 일 때.
// 실패 시 PR.status 를 'review-needed' 로 폴백, triage_decisions.reason 에도 사유 기록.

import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { prs, projects, triageDecisions } from '@/db/schema';
import { deletePRHeadBranch, mergePR, requestChangesReview } from './github';

export type AutoMergeResult =
  | { kind: 'merged'; sha: string }
  | {
      kind: 'skipped';
      reason:
        | 'no-pr'
        | 'no-project'
        | 'no-installation'
        | 'wrong-status'
        | 'no-decision'
        | 'not-auto-merge';
    }
  | { kind: 'failed'; reason: string };

// PR 1건에 대한 머지 시도. 호출자는 runTriage 결과 보고 시점을 정한다.
// 성공: PR.status='merged' (+ 머지된 head 브랜치 자동 삭제). 실패/거부: PR.status='review-needed' + 사유 갱신.
//
// race-safe: GitHub 가 같은 PR 의 check_run/check_suite completed 두 webhook 을 거의 동시에
// 보내면 handleCheckWebhook 가 병렬 두 번 실행 → 둘 다 attemptAutoMerge 호출 → 두 번째가
// "Merge already in progress" 또는 "Pull Request is not mergeable" 응답하는 케이스.
// 이런 경우 첫 호출이 성공한 상태라 실패 처리하지 않고 success 로 정정.
const RACE_ERROR_PATTERNS = [
  /Merge already in progress/i,
  /Pull Request is not mergeable/i, // 이미 머지된 PR 은 not mergeable 로 응답되기도 함
];

function isRaceMergeError(message: string): boolean {
  return RACE_ERROR_PATTERNS.some((re) => re.test(message));
}

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
  if (project.installationId === null) return { kind: 'skipped', reason: 'no-installation' };

  const [owner, repo] = project.slug.split('/');

  try {
    // commitTitle 미전송 — GitHub default ('<PR title> (#<number>)') 를 그대로 사용.
    const result = await mergePR(project.installationId, { owner, repo }, pr.number, {
      method: 'squash',
    });
    if (!result.merged) {
      return revertToReviewNeeded(prId, 'GitHub 머지 거부 — merged=false 반환.');
    }
    db.update(prs).set({ status: 'merged', updatedAt: new Date() }).where(eq(prs.id, prId)).run();
    // 머지된 head 브랜치 자동 삭제 — 실패해도 머지 자체는 성공으로 처리. 사용자가
    // /pr 상세에서 수동 삭제 가능.
    await safeDeleteBranch(prId);
    return { kind: 'merged', sha: result.sha };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // race condition — 다른 병렬 호출이 이미 머지 성공한 경우. PR.status='merged' 로
    // 정정 + 'merged' 로 응답. revertToReviewNeeded 호출 안 함 (triage decision 보존).
    if (isRaceMergeError(message)) {
      db.update(prs).set({ status: 'merged', updatedAt: new Date() }).where(eq(prs.id, prId)).run();
      await safeDeleteBranch(prId);
      // sha 정확히 모르면 빈 문자열 — UI 는 short sha 7자만 쓰므로 빈 문자열도 큰 문제 없음.
      return { kind: 'merged', sha: '' };
    }
    return revertToReviewNeeded(prId, `GitHub 머지 실패: ${message}`);
  }
}

// 자동 머지 후 head 브랜치 자동 삭제. 실패해도 머지 자체는 영향 없음.
async function safeDeleteBranch(prId: number): Promise<void> {
  try {
    await deleteMergedBranch(prId);
  } catch (err) {
    console.error(`자동 브랜치 삭제 실패 (PR ${prId}):`, err);
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

// 사용자가 PR 상세에서 "전체 머지" 를 직접 누른 흐름. attemptAutoMerge 와 달리
// status · triage decision 검사를 우회 — 사람의 명시적 결정이 정책보다 우선.
// merged · closed PR 만 skip. GitHub 머지 호출 + DB 반영 + triage decidedBy='human' 기록.
export type HumanMergeResult =
  | { kind: 'merged'; sha: string }
  | { kind: 'skipped'; reason: 'no-pr' | 'no-project' | 'no-installation' | 'already-closed' }
  | { kind: 'failed'; reason: string };

export async function attemptHumanMerge(prId: number): Promise<HumanMergeResult> {
  const pr = db.select().from(prs).where(eq(prs.id, prId)).get();
  if (!pr) return { kind: 'skipped', reason: 'no-pr' };
  if (pr.status === 'merged' || pr.status === 'closed') {
    return { kind: 'skipped', reason: 'already-closed' };
  }

  const project = db.select().from(projects).where(eq(projects.id, pr.repoId)).get();
  if (!project) return { kind: 'skipped', reason: 'no-project' };
  if (project.installationId === null) return { kind: 'skipped', reason: 'no-installation' };

  const [owner, repo] = project.slug.split('/');

  try {
    // commitTitle 미전송 — GitHub default ('<PR title> (#<number>)') 를 그대로 사용.
    const result = await mergePR(project.installationId, { owner, repo }, pr.number, {
      method: 'squash',
    });
    if (!result.merged) {
      return { kind: 'failed', reason: 'GitHub 머지 거부 — merged=false 반환.' };
    }
    db.update(prs).set({ status: 'merged', updatedAt: new Date() }).where(eq(prs.id, prId)).run();
    // 사람 결정 기록 — 자동 머지 정책과 구분되게 decidedBy='human'.
    const existing = db
      .select({ id: triageDecisions.id })
      .from(triageDecisions)
      .where(eq(triageDecisions.prId, prId))
      .get();
    const values = {
      prId,
      decision: 'auto-merge' as const,
      reason: '사용자가 PR 상세에서 직접 머지.',
      decidedBy: 'human' as const,
      decidedAt: new Date(),
    };
    if (existing) {
      db.update(triageDecisions).set(values).where(eq(triageDecisions.id, existing.id)).run();
    } else {
      db.insert(triageDecisions).values(values).run();
    }
    return { kind: 'merged', sha: result.sha };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { kind: 'failed', reason: `GitHub 머지 실패: ${message}` };
  }
}

// 머지 후 head 브랜치 삭제 — UI 의 "브랜치 삭제" 버튼이 호출. PR.status='merged' 만 처리.
// fork/cross-repo 인 경우 deletePRHeadBranch 가 skip 반환.
// 성공 시 prs.branchDeletedAt 기록 — PR 상세 재방문 시 버튼이 비활성화되도록.
export type DeletePRBranchResult =
  | { kind: 'deleted'; ref: string }
  | {
      kind: 'skipped';
      reason:
        | 'no-pr'
        | 'no-project'
        | 'no-installation'
        | 'not-merged'
        | 'fork-or-cross-repo'
        | 'already-deleted';
    }
  | { kind: 'failed'; reason: string };

export async function deleteMergedBranch(prId: number): Promise<DeletePRBranchResult> {
  const pr = db.select().from(prs).where(eq(prs.id, prId)).get();
  if (!pr) return { kind: 'skipped', reason: 'no-pr' };
  if (pr.status !== 'merged') return { kind: 'skipped', reason: 'not-merged' };
  // 이미 삭제된 브랜치 — 멱등 skip. UI 가 버튼을 disable 한 채로 두기 위함.
  if (pr.branchDeletedAt !== null) return { kind: 'skipped', reason: 'already-deleted' };

  const project = db.select().from(projects).where(eq(projects.id, pr.repoId)).get();
  if (!project) return { kind: 'skipped', reason: 'no-project' };
  if (project.installationId === null) return { kind: 'skipped', reason: 'no-installation' };

  const [owner, repo] = project.slug.split('/');
  try {
    const result = await deletePRHeadBranch(project.installationId, { owner, repo }, pr.number);
    if (result.kind === 'skipped') return { kind: 'skipped', reason: result.reason };
    // 성공 — branchDeletedAt 기록.
    db.update(prs).set({ branchDeletedAt: new Date() }).where(eq(prs.id, prId)).run();
    return { kind: 'deleted', ref: result.ref };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { kind: 'failed', reason: `브랜치 삭제 실패: ${message}` };
  }
}

// 사용자가 PR 상세에서 '변경 요청' 누른 흐름. GitHub REQUEST_CHANGES 리뷰 제출 →
// PR 이 차단 상태로 표시되고 작성자에게 알림. PR.status 는 review-needed 유지.
// body 는 호출자가 제공 (자동 생성된 사전 리뷰 요약 + 사용자 입력).
export type RequestChangesResult =
  | { kind: 'submitted'; reviewId: number }
  | { kind: 'skipped'; reason: 'no-pr' | 'no-project' | 'no-installation' | 'already-closed' }
  | { kind: 'failed'; reason: string };

export async function submitRequestChanges(
  prId: number,
  body: string,
): Promise<RequestChangesResult> {
  const pr = db.select().from(prs).where(eq(prs.id, prId)).get();
  if (!pr) return { kind: 'skipped', reason: 'no-pr' };
  if (pr.status === 'merged' || pr.status === 'closed') {
    return { kind: 'skipped', reason: 'already-closed' };
  }

  const project = db.select().from(projects).where(eq(projects.id, pr.repoId)).get();
  if (!project) return { kind: 'skipped', reason: 'no-project' };
  if (project.installationId === null) return { kind: 'skipped', reason: 'no-installation' };

  const [owner, repo] = project.slug.split('/');
  try {
    const result = await requestChangesReview(
      project.installationId,
      { owner, repo },
      pr.number,
      body,
    );
    return { kind: 'submitted', reviewId: result.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { kind: 'failed', reason: `변경 요청 실패: ${message}` };
  }
}
