// Phase 5.4 — runTriage 가 'auto-merge' 로 결정한 PR 을 실제로 GitHub 에 머지.
// 호출 시점: sync.ts 안 runTriage 결과가 'decided' + 'auto-merge' 일 때.
// 실패 시 PR.status 를 'review-needed' 로 폴백, triage_decisions.reason 에도 사유 기록.

import { and, eq, lt } from 'drizzle-orm';
import { db } from '@/db/client';
import { prs, projects, triageDecisions, type PRRecord } from '@/db/schema';
import { attemptConflictResolution } from './conflict-resolve';
import {
  closePR,
  deletePRHeadBranch,
  isPullRequestMerged,
  mergePR,
  requestChangesReview,
} from './github';
import { logger } from './logger';
import { createNotification } from './notifications';
import { matchAndApplyDoneFromPR } from './roadmap';
import { getWorkspace, pullWorkspace } from './workspace';

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
        | 'not-auto-merge'
        | 'in-progress'
        // Phase 13.2 — 충돌을 자동 해결 중. push 가 새 webhook 을 발사해 재트라이아지+재머지.
        | 'conflict-resolving';
    }
  | { kind: 'failed'; reason: string };

// PR 1건에 대한 머지 시도. 호출자는 runTriage 결과 보고 시점을 정한다.
// 성공: PR.status='merged' (+ 머지된 head 브랜치 자동 삭제). 실패/거부: PR.status='review-needed' + 사유 갱신.
//
// race-safe: GitHub 가 같은 PR 의 check_run/check_suite completed 두 webhook 을 거의 동시에
// SHA/base 불일치 — PR head(또는 base)가 분석 후 이동한 경우. GitHub 가 405 "Head branch was
// modified" / "Base branch was modified" 류 응답. 새 commit 의 webhook 이 새 분석/머지를 다시
// 트리거하므로 여기선 idle 로 복귀(human-review 로 안 떨어뜨림). base 이동도 재트라이지하면
// 회복되므로 동일 처리(예전엔 base-modified 가 패턴에 없어 불필요하게 human-review 로 강등됐음).
const SHA_MISMATCH_PATTERNS = [
  /Head branch was modified/i,
  /Base branch was modified/i,
  /head.*modified/i,
  /base.*modified/i,
  /sha.*does.*match/i,
  /expected.*sha/i,
];

function isShaMismatchError(message: string): boolean {
  return SHA_MISMATCH_PATTERNS.some((re) => re.test(message));
}

// 머지 에러 catch 시 "정말 머지됐는지" GitHub 에 확정 조회. 조회 실패 시 false(보수적 — 확실치
// 않으면 merged 로 마킹하지 않아, 머지 안 된 PR 을 merged 로 오인하는 사고를 막는다).
async function safeIsMerged(
  installationId: number,
  ref: { owner: string; repo: string },
  number: number,
): Promise<boolean> {
  try {
    return await isPullRequestMerged(installationId, ref, number);
  } catch {
    return false;
  }
}

// 같은 PR 에 대한 동시 머지 시도를 막는 in-process lock.
const inFlightMerges = new Set<number>();

export async function attemptAutoMerge(prId: number): Promise<AutoMergeResult> {
  const pr = db.select().from(prs).where(eq(prs.id, prId)).get();
  if (!pr) return { kind: 'skipped', reason: 'no-pr' };

  // runTriage 가 'auto-mergeable' 로 표시한 PR 만 실제 머지.
  // 이미 머지/닫힘이면 멱등 skip.
  if (pr.status !== 'auto-mergeable') return { kind: 'skipped', reason: 'wrong-status' };

  // 동시 실행 가드 — GitHub 가 같은 PR 의 여러 webhook (synchronize · check_run completed) 을
  // 거의 동시에 보내면 attemptAutoMerge 가 병렬로 들어와, 한 호출은 머지 성공 (auto-merged 알림)·
  // 다른 호출은 'already merged' 오류가 RACE 패턴에 안 걸려 revertToReviewNeeded 로 triage 를
  // human-review 로 덮어쓴다 → 대시보드 '수동' 오분류 + 자동 카운트 누락 + 모순된 실패 알림.
  // better-sqlite3 가 동기라 status 읽기~lock 획득 사이 yield 가 없어 in-process lock 으로 충분.
  if (inFlightMerges.has(prId)) return { kind: 'skipped', reason: 'in-progress' };
  inFlightMerges.add(prId);
  try {
    return await runAutoMerge(pr);
  } finally {
    inFlightMerges.delete(prId);
  }
}

// 주기 reconcile — 'auto-mergeable' 로 표시됐으나 오래(maxAgeMs) 머지 안 된 채 방치된 PR 을
// attemptAutoMerge 로 재시도. 정상 흐름에선 triage 직후 즉시 머지되므로, 'auto-mergeable' 로 오래
// 남았다는 건 머지가 누락된 것(synchronize/check_run webhook 유실, triage~merge 사이 크래시 등)이다.
// attemptAutoMerge 의 가드(status 재확인·in-flight lock·SHA 가드·merged 실제조회·author 권한 게이트는
// triage 시점 결정에 반영됨)가 그대로 작동하므로 안전 — 승인된 머지만 완료하고, head 가 그 사이
// 이동했으면(재분석 필요) SHA 가드가 skip(무해). dropped-webhook-but-mergeable·이미-머지됨 케이스를
// 복구한다. (head 이동 후 새 commit 재분석은 webhook 의존 — 별도.)
export async function reconcileStuckAutoMerges(maxAgeMs: number): Promise<{ retried: number }> {
  const cutoff = new Date(Date.now() - maxAgeMs);
  const stuck = db
    .select({ id: prs.id })
    .from(prs)
    .where(and(eq(prs.status, 'auto-mergeable'), lt(prs.updatedAt, cutoff)))
    .all();
  let retried = 0;
  for (const { id } of stuck) {
    try {
      await attemptAutoMerge(id);
      retried += 1;
    } catch (err) {
      logger.error(
        { source: 'auto-merge', op: 'reconcileStuck', prId: id, err },
        'stuck auto-merge 재시도 실패',
      );
    }
  }
  return { retried };
}

async function runAutoMerge(pr: PRRecord): Promise<AutoMergeResult> {
  const prId = pr.id;
  const decision = db.select().from(triageDecisions).where(eq(triageDecisions.prId, prId)).get();
  if (!decision) return { kind: 'skipped', reason: 'no-decision' };
  if (decision.decision !== 'auto-merge') return { kind: 'skipped', reason: 'not-auto-merge' };

  const project = db.select().from(projects).where(eq(projects.id, pr.repoId)).get();
  if (!project) return { kind: 'skipped', reason: 'no-project' };
  if (project.installationId === null) return { kind: 'skipped', reason: 'no-installation' };

  const [owner, repo] = project.slug.split('/');

  // Phase 13.2 — 충돌 자동 해결 토글이 켜진 프로젝트는 머지 전에 충돌 여부를 확인하고
  // dirty 면 claude CLI 로 해결 시도. 해결되면 push 가 새 webhook 을 발사해 재트라이아지+
  // 재머지가 일어나므로 이번 시도는 보류. 토글 OFF 면 추가 API 호출 없이 기존 흐름.
  if (project.autoResolveConflictsEnabled) {
    const resolution = await attemptConflictResolution(prId);
    if (resolution.kind === 'resolved') {
      return { kind: 'skipped', reason: 'conflict-resolving' };
    }
    if (resolution.kind === 'failed') {
      // conflict-resolve 가 이미 PR 코멘트 + 알림을 남김 — 중복 알림 방지로 notify=false.
      return revertToReviewNeeded(prId, `충돌 자동 해결 실패: ${resolution.reason}`, false);
    }
    if (resolution.kind === 'skipped' && resolution.reason === 'too-large') {
      return revertToReviewNeeded(
        prId,
        '머지 충돌 — 충돌 규모가 커 사람 검토가 필요합니다.',
        false,
      );
    }
    // 그 외 skipped(not-dirty 등) — 충돌이 아니므로 정상 머지 흐름 계속.
  }

  try {
    // commitTitle 미전송 — GitHub default ('<PR title> (#<number>)') 를 그대로 사용.
    // sha — 분석 시점 head 와 같을 때만 머지 (race 가드). GitHub 가 head 이동 감지 시 405 거부.
    const result = await mergePR(project.installationId, { owner, repo }, pr.number, {
      method: 'squash',
      sha: pr.headSha,
    });
    if (!result.merged) {
      return revertToReviewNeeded(prId, 'GitHub 머지 거부 — merged=false 반환.');
    }
    db.update(prs).set({ status: 'merged', updatedAt: new Date() }).where(eq(prs.id, prId)).run();
    // 머지된 head 브랜치 자동 삭제 — 실패해도 머지 자체는 성공으로 처리. 사용자가
    // /pr 상세에서 수동 삭제 가능.
    await safeDeleteBranch(prId);
    // Phase 10 — PR 본문의 Closes #PHASE-N / Closes #ITEM-N 매칭해 자동 done.
    safeApplyRoadmap(prId);
    await safeAutoPull(prId);
    safeNotify({ kind: 'auto-merged', prId });
    return { kind: 'merged', sha: result.sha };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // SHA/base 불일치 (head·base 가 그 사이 이동) — 새 commit 의 sync webhook 이 새 분석/triage 를
    // 돌리므로 여기선 그냥 idle 로 복귀(상태 'auto-mergeable' 유지). human-review 로 안 떨어뜨림.
    if (isShaMismatchError(message)) {
      return { kind: 'skipped', reason: 'wrong-status' };
    }
    // 그 외 머지 에러 — "이미 머지됨(병렬/외부 race)" 인지 GitHub 에 **실제 머지 상태로 확정**한다.
    // 예전엔 'Pull Request is not mergeable' 같은 메시지를 무조건 race(=성공)로 가정해, 충돌·CI
    // 실패·브랜치보호로 **머지 안 된** PR 을 merged 로 마킹하고 브랜치 삭제·로드맵 done 처리하던
    // 사고가 있었다(리뷰 발견). 진짜 머지된 경우만 merged 처리, 아니면 human-review 로.
    if (await safeIsMerged(project.installationId, { owner, repo }, pr.number)) {
      db.update(prs).set({ status: 'merged', updatedAt: new Date() }).where(eq(prs.id, prId)).run();
      await safeDeleteBranch(prId);
      safeApplyRoadmap(prId);
      await safeAutoPull(prId);
      // sha 정확히 모르면 빈 문자열 — UI 는 short sha 7자만 쓰므로 빈 문자열도 큰 문제 없음.
      return { kind: 'merged', sha: '' };
    }
    return revertToReviewNeeded(prId, `GitHub 머지 실패: ${message}`);
  }
}

// 알림 생성은 best-effort — DB 실패해도 머지 흐름엔 영향 없게.
function safeNotify(input: Parameters<typeof createNotification>[0]): void {
  try {
    createNotification(input);
  } catch (err) {
    console.error('알림 생성 실패:', err);
  }
}

// Phase 10 — 로드맵 매칭도 best-effort. PR body 정규식 매칭만 하므로 실패 거의 없음.
function safeApplyRoadmap(prId: number): void {
  try {
    matchAndApplyDoneFromPR(prId);
  } catch (err) {
    console.error('로드맵 자동 done 매칭 실패:', err);
  }
}

// 자동 머지 후 head 브랜치 자동 삭제 — 프로젝트의 autoDeleteBranchEnabled 가 켜진 경우만.
// 회사/조직 레포에서 남의 브랜치를 함부로 지우면 안 되므로 디폴트 OFF. 실패해도 머지엔 영향 없음.
// (수동 '브랜치 삭제' 버튼은 명시적 액션이라 이 게이트와 무관하게 동작.)
async function safeDeleteBranch(prId: number): Promise<void> {
  try {
    const pr = db.select({ repoId: prs.repoId }).from(prs).where(eq(prs.id, prId)).get();
    if (!pr) return;
    const project = db
      .select({ autoDeleteBranchEnabled: projects.autoDeleteBranchEnabled })
      .from(projects)
      .where(eq(projects.id, pr.repoId))
      .get();
    if (!project?.autoDeleteBranchEnabled) return;
    await deleteMergedBranch(prId);
  } catch (err) {
    console.error(`자동 브랜치 삭제 실패 (PR ${prId}):`, err);
  }
}

// Phase 20 — 머지 후 해당 프로젝트의 로컬 워크스페이스를 자동 git pull (수동 pull 번거로움 해소).
// 워크스페이스 등록 자체가 opt-in — 등록 안 했으면 대상 아님. `pull --ff-only` 라 로컬
// 변경/발산이 있으면 git 이 거부(비파괴), best-effort 라 실패해도 머지엔 영향 없음. 아직 clone
// 안 된(빈 디렉토리) 워크스페이스는 머지 이벤트에서 무거운 clone 을 트리거하지 않게 skip.
async function safeAutoPull(prId: number): Promise<void> {
  try {
    const pr = db.select({ repoId: prs.repoId }).from(prs).where(eq(prs.id, prId)).get();
    if (!pr) return;
    const ws = getWorkspace(pr.repoId);
    // 워크스페이스 미등록은 사용자가 의식적으로 안 한 경우라 알림 안 함(스팸 방지). 디버그용 로그만.
    if (!ws) {
      logger.debug(
        { source: 'auto-merge', op: 'safeAutoPull', prId, projectId: pr.repoId },
        '자동 git pull 스킵 — 등록된 워크스페이스 없음',
      );
      return;
    }
    // 사용자 보고(2026-06-05): 자동 git pull 이 제대로 동작 안 함. 원인 1 — 워크스페이스가 빈
    // 디렉토리/없는 경로로 등록된 경우(needsClone=true) safeAutoPull 이 조기 return 했다. 첫
    // 머지 시 clone 으로 살려야 할 케이스(워크스페이스 등록의 본래 의도: 첫 pull 이 clone)를
    // 막아 사용자가 "동작 안 함"으로 인지했음. pullWorkspace 가 이미 isGitRepo 분기로 clone 을
    // 처리하므로, 여기선 더 이상 needsClone 으로 거르지 않는다.
    // 결과를 알림으로 표면화 — 이전엔 조용히 돌아 성공/실패를 알 수 없었다(특히 워크스페이스가
    // 다른 브랜치에 있어 ff-only 가 거부되는 케이스가 보이지 않았음). 실패 사유까지 노출.
    const result = await pullWorkspace(pr.repoId);
    if (result.kind === 'pulled' || result.kind === 'cloned') {
      safeNotify({ kind: 'workspace-pulled', prId });
    } else if (result.kind === 'failed') {
      safeNotify({ kind: 'workspace-pull-failed', prId, reason: result.output });
    } else if (result.kind === 'skipped-in-flight') {
      // 같은 repo 의 동시 머지 — 진행 중 pull 이 방금 머지분을 자연히 가져오므로 알림 불요(스팸 방지).
      logger.debug(
        { source: 'auto-merge', op: 'safeAutoPull', prId },
        '자동 git pull 스킵 — 같은 워크스페이스의 다른 pull 진행 중(in-flight)',
      );
    }
    // result.kind === 'no-workspace' 는 위 ws 가드에서 이미 걸러져 도달 불가.
  } catch (err) {
    logger.error(
      { source: 'auto-merge', op: 'safeAutoPull', prId, err },
      '머지 후 자동 git pull 실패',
    );
  }
}

// 머지 실패 시 사람 검토로 되돌림 — triage_decisions.reason 갱신해서 UI 에 사유 노출.
// notify=false 는 호출부(충돌 해결 흐름)가 이미 알림을 남긴 경우 중복 방지용.
function revertToReviewNeeded(prId: number, reason: string, notify = true): AutoMergeResult {
  db.update(prs)
    .set({ status: 'review-needed', updatedAt: new Date() })
    .where(eq(prs.id, prId))
    .run();
  db.update(triageDecisions)
    .set({ decision: 'human-review', reason, decidedBy: 'system', decidedAt: new Date() })
    .where(eq(triageDecisions.prId, prId))
    .run();
  if (notify) safeNotify({ kind: 'auto-merge-failed', prId, reason });
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
    // 머지 = 브랜치 삭제 (자동/사람 모두 동일). 별도 '브랜치 삭제' 액션 흐름 제거 —
    // 사용자가 두 번 클릭할 필요 없게. fork/cross-repo 는 자동 skip.
    await safeDeleteBranch(prId);
    // Phase 10 — PR 본문의 Closes 컨벤션 매칭해 자동 done.
    safeApplyRoadmap(prId);
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
    await safeAutoPull(prId);
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

// 사용자가 PR 상세에서 'PR 닫기' 누른 흐름 — 머지 안 하고 폐기. 테스트용 PR 또는
// 의미 없어진 PR 정리. attemptHumanMerge 와 같이 status·triage 검사 우회 (사람 결정 우선).
// 머지된 PR 은 닫을 수 없음 (이미 끝남). 닫힌 PR 도 멱등 skip.
export type ClosePRResult =
  | { kind: 'closed'; number: number }
  | { kind: 'skipped'; reason: 'no-pr' | 'no-project' | 'no-installation' | 'already-closed' }
  | { kind: 'failed'; reason: string };

export async function closePullRequest(prId: number): Promise<ClosePRResult> {
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
    const result = await closePR(project.installationId, { owner, repo }, pr.number);
    if (!result.closed) {
      return { kind: 'failed', reason: 'GitHub 응답 — closed=false 반환.' };
    }
    db.update(prs).set({ status: 'closed', updatedAt: new Date() }).where(eq(prs.id, prId)).run();
    return { kind: 'closed', number: result.number };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { kind: 'failed', reason: `PR 닫기 실패: ${message}` };
  }
}
