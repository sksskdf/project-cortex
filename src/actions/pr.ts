'use server';

// Phase 5 후속 — PR 상세 화면의 "전체 머지" + "브랜치 삭제" 버튼 wire-up.
// 사람의 명시적 결정이므로 lib/auto-merge 의 사람용 함수 (attemptHumanMerge ·
// deleteMergedBranch) 를 호출.

import { revalidatePath } from 'next/cache';
import {
  attemptHumanMerge,
  closePullRequest,
  deleteMergedBranch,
  submitRequestChanges,
  type ClosePRResult,
  type DeletePRBranchResult,
  type HumanMergeResult,
  type RequestChangesResult,
} from '@/lib/auto-merge';
import { analyzePR } from '@/lib/pre-review';
import { markPRRead, markPRsRead } from '@/lib/pr-read';

export type PRMergeActionState =
  | { kind: 'idle' }
  | { kind: 'merged'; sha: string }
  | { kind: 'error'; message: string };

export type PRBranchDeleteState =
  | { kind: 'idle' }
  | { kind: 'deleted'; ref: string }
  | { kind: 'skipped'; message: string }
  | { kind: 'error'; message: string };

function parsePrId(viewId: string): number | null {
  const match = viewId.match(/^pr-(\d+)$/);
  if (!match) return null;
  return Number(match[1]);
}

export async function mergePRAction(viewId: string): Promise<PRMergeActionState> {
  const dbId = parsePrId(viewId);
  if (dbId === null) return { kind: 'error', message: '잘못된 PR ID 입니다.' };

  let result: HumanMergeResult;
  try {
    result = await attemptHumanMerge(dbId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { kind: 'error', message };
  }

  revalidatePath(`/pr/${viewId}`);
  revalidatePath('/inbox');
  revalidatePath('/');

  if (result.kind === 'merged') return { kind: 'merged', sha: result.sha };
  if (result.kind === 'failed') return { kind: 'error', message: result.reason };
  return { kind: 'error', message: mapSkipReason(result.reason) };
}

function mapSkipReason(
  reason: 'no-pr' | 'no-project' | 'no-installation' | 'already-closed',
): string {
  switch (reason) {
    case 'no-pr':
      return 'PR 을 찾을 수 없습니다.';
    case 'no-project':
      return '연결된 프로젝트가 없습니다.';
    case 'no-installation':
      return 'GitHub App 설치 정보가 없어 머지할 수 없습니다.';
    case 'already-closed':
      return '이미 머지되거나 닫힌 PR 입니다.';
  }
}

export async function deletePRBranchAction(viewId: string): Promise<PRBranchDeleteState> {
  const dbId = parsePrId(viewId);
  if (dbId === null) return { kind: 'error', message: '잘못된 PR ID 입니다.' };

  let result: DeletePRBranchResult;
  try {
    result = await deleteMergedBranch(dbId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { kind: 'error', message };
  }

  revalidatePath(`/pr/${viewId}`);

  if (result.kind === 'deleted') return { kind: 'deleted', ref: result.ref };
  if (result.kind === 'failed') return { kind: 'error', message: result.reason };
  return { kind: 'skipped', message: mapDeleteSkipReason(result.reason) };
}

function mapDeleteSkipReason(
  reason:
    | 'no-pr'
    | 'no-project'
    | 'no-installation'
    | 'not-merged'
    | 'fork-or-cross-repo'
    | 'already-deleted',
): string {
  switch (reason) {
    case 'no-pr':
      return 'PR 을 찾을 수 없습니다.';
    case 'no-project':
      return '연결된 프로젝트가 없습니다.';
    case 'no-installation':
      return 'GitHub App 설치 정보가 없어 브랜치를 삭제할 수 없습니다.';
    case 'not-merged':
      return '머지되지 않은 PR 입니다.';
    case 'fork-or-cross-repo':
      return 'fork 또는 다른 레포의 브랜치라 Cortex 가 삭제할 수 없습니다.';
    case 'already-deleted':
      return '이미 삭제된 브랜치입니다.';
  }
}

// 사용자가 PR 상세에서 "AI 분석 요청" 버튼을 누른 흐름. AI 토글 ON 인지
// analyzePR 안에서 다시 확인하므로 race 안전. preReview 없는 PR 만 의미 있음.
export type PRAnalyzeState =
  | { kind: 'idle' }
  | { kind: 'analyzed' }
  | { kind: 'skipped'; message: string }
  | { kind: 'error'; message: string };

export async function requestAnalysisAction(viewId: string): Promise<PRAnalyzeState> {
  const dbId = parsePrId(viewId);
  if (dbId === null) return { kind: 'error', message: '잘못된 PR ID 입니다.' };

  try {
    const result = await analyzePR(dbId);
    revalidatePath(`/pr/${viewId}`);
    revalidatePath('/inbox');
    if (result.kind === 'analyzed' || result.kind === 'cached') return { kind: 'analyzed' };
    return { kind: 'skipped', message: mapAnalyzeSkipReason(result.reason) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { kind: 'error', message };
  }
}

function mapAnalyzeSkipReason(
  reason: 'no-pr' | 'no-project' | 'no-installation' | 'ai-disabled',
): string {
  switch (reason) {
    case 'no-pr':
      return 'PR 을 찾을 수 없습니다.';
    case 'no-project':
      return '연결된 프로젝트가 없습니다.';
    case 'no-installation':
      return 'GitHub App 설치 정보가 없어 분석할 수 없습니다.';
    case 'ai-disabled':
      return '설정에서 AI 분석이 비활성화되어 있습니다.';
  }
}

// 사용자가 PR 상세 '변경 요청' 누른 흐름. body 가 비어있으면 사전 리뷰 summary 가
// 있을 때 그것을, 없으면 generic 안내 문자열을 사용.
export type PRRequestChangesState =
  | { kind: 'idle' }
  | { kind: 'submitted' }
  | { kind: 'skipped'; message: string }
  | { kind: 'error'; message: string };

export async function requestChangesAction(
  viewId: string,
  body: string,
): Promise<PRRequestChangesState> {
  const dbId = parsePrId(viewId);
  if (dbId === null) return { kind: 'error', message: '잘못된 PR ID 입니다.' };

  const trimmed = body.trim();
  const finalBody =
    trimmed.length > 0
      ? trimmed
      : 'Cortex 사용자가 변경 요청을 보냅니다. 사전 리뷰 결과와 자동 분석을 확인해 주세요.';

  let result: RequestChangesResult;
  try {
    result = await submitRequestChanges(dbId, finalBody);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { kind: 'error', message };
  }

  revalidatePath(`/pr/${viewId}`);

  if (result.kind === 'submitted') return { kind: 'submitted' };
  if (result.kind === 'failed') return { kind: 'error', message: result.reason };
  return { kind: 'skipped', message: mapRequestChangesSkipReason(result.reason) };
}

function mapRequestChangesSkipReason(
  reason: 'no-pr' | 'no-project' | 'no-installation' | 'already-closed',
): string {
  switch (reason) {
    case 'no-pr':
      return 'PR 을 찾을 수 없습니다.';
    case 'no-project':
      return '연결된 프로젝트가 없습니다.';
    case 'no-installation':
      return 'GitHub App 설치 정보가 없어 리뷰를 보낼 수 없습니다.';
    case 'already-closed':
      return '이미 머지되거나 닫힌 PR 입니다.';
  }
}

// 사용자가 PR 상세에서 'PR 닫기' 누른 흐름. 머지 없이 폐기 — 테스트용 또는 의미 없어진
// PR 정리. closePullRequest 가 GitHub API 호출 + DB status='closed' 갱신.
export type PRCloseState =
  | { kind: 'idle' }
  | { kind: 'closed'; number: number }
  | { kind: 'skipped'; message: string }
  | { kind: 'error'; message: string };

export async function closePRAction(viewId: string): Promise<PRCloseState> {
  const dbId = parsePrId(viewId);
  if (dbId === null) return { kind: 'error', message: '잘못된 PR ID 입니다.' };

  let result: ClosePRResult;
  try {
    result = await closePullRequest(dbId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { kind: 'error', message };
  }

  revalidatePath(`/pr/${viewId}`);
  revalidatePath('/inbox');
  revalidatePath('/');

  if (result.kind === 'closed') return { kind: 'closed', number: result.number };
  if (result.kind === 'failed') return { kind: 'error', message: result.reason };
  return { kind: 'skipped', message: mapCloseSkipReason(result.reason) };
}

// Phase 20 — PR 확인/미확인 토글. 사용자가 머지된 PR 을 검토했는지 추적.
export type PRReadActionState =
  | { kind: 'idle' }
  | { kind: 'marked'; read: boolean }
  | { kind: 'error'; message: string };

export async function markPRReadAction(viewId: string, read: boolean): Promise<PRReadActionState> {
  const dbId = parsePrId(viewId);
  if (dbId === null) return { kind: 'error', message: '잘못된 PR ID 입니다.' };

  try {
    markPRRead(dbId, read);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { kind: 'error', message };
  }

  revalidatePath(`/pr/${viewId}`);
  revalidatePath('/inbox');
  revalidatePath('/');
  return { kind: 'marked', read };
}

// Phase 20 — 라이트 모달 뷰어가 앞뒤로 넘기며 본 PR 들을 닫을 때 일괄 확인 처리.
// viewId 목록("pr-N")을 받아 유효한 것만 일괄 read. 이미 읽은 건 markPRsRead 가 멱등 처리.
export async function markPRsReadAction(
  viewIds: ReadonlyArray<string>,
): Promise<{ updated: number }> {
  const ids = viewIds.map(parsePrId).filter((x): x is number => x !== null);
  if (ids.length === 0) return { updated: 0 };

  let updated = 0;
  try {
    updated = markPRsRead(ids).updated;
  } catch (err) {
    console.error('markPRsRead 실패:', err);
    return { updated: 0 };
  }

  revalidatePath('/inbox');
  revalidatePath('/');
  return { updated };
}

function mapCloseSkipReason(
  reason: 'no-pr' | 'no-project' | 'no-installation' | 'already-closed',
): string {
  switch (reason) {
    case 'no-pr':
      return 'PR 을 찾을 수 없습니다.';
    case 'no-project':
      return '연결된 프로젝트가 없습니다.';
    case 'no-installation':
      return 'GitHub App 설치 정보가 없어 닫을 수 없습니다.';
    case 'already-closed':
      return '이미 머지되거나 닫힌 PR 입니다.';
  }
}
