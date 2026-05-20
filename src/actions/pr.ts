'use server';

// Phase 5 후속 — PR 상세 화면의 "전체 머지" 버튼 wire-up.
// 사람의 명시적 결정이므로 lib/auto-merge.attemptHumanMerge 를 호출.

import { revalidatePath } from 'next/cache';
import { attemptHumanMerge, type HumanMergeResult } from '@/lib/auto-merge';

export type PRMergeActionState =
  | { kind: 'idle' }
  | { kind: 'merged'; sha: string }
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
