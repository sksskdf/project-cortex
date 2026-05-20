'use server';

// Phase 5 후속 — PR 상세 화면의 "전체 머지" + "브랜치 삭제" 버튼 wire-up.
// 사람의 명시적 결정이므로 lib/auto-merge 의 사람용 함수 (attemptHumanMerge ·
// deleteMergedBranch) 를 호출.

import { revalidatePath } from 'next/cache';
import {
  attemptHumanMerge,
  deleteMergedBranch,
  type DeletePRBranchResult,
  type HumanMergeResult,
} from '@/lib/auto-merge';

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
  reason: 'no-pr' | 'no-project' | 'no-installation' | 'not-merged' | 'fork-or-cross-repo',
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
  }
}
