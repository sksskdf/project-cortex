'use server';

// Phase 6 — 클러스터 일괄 액션. UI 에서 폼 action 으로 호출.
// 머지/해체 둘 다 멱등 — 이미 처리된 상태면 lib 함수가 알아서 skip.

import { revalidatePath } from 'next/cache';
import { dissolveCluster, mergeCluster, type ClusterMergeResult } from '@/lib/clustering';

export type ClusterActionState =
  | { kind: 'idle' }
  | { kind: 'merged'; result: ClusterMergeResult }
  | { kind: 'dissolved'; released: number }
  | { kind: 'error'; message: string };

function parseClusterId(viewId: string): number | null {
  const match = viewId.match(/^cluster-(\d+)$/);
  if (!match) return null;
  return Number(match[1]);
}

export async function mergeClusterAction(viewId: string): Promise<ClusterActionState> {
  const dbId = parseClusterId(viewId);
  if (dbId === null) return { kind: 'error', message: '잘못된 클러스터 ID 입니다.' };

  try {
    const result = await mergeCluster(dbId);
    revalidatePath(`/cluster/${viewId}`);
    revalidatePath('/inbox');
    revalidatePath('/');
    return { kind: 'merged', result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { kind: 'error', message };
  }
}

export async function dissolveClusterAction(viewId: string): Promise<ClusterActionState> {
  const dbId = parseClusterId(viewId);
  if (dbId === null) return { kind: 'error', message: '잘못된 클러스터 ID 입니다.' };

  try {
    const { released } = dissolveCluster(dbId);
    revalidatePath(`/cluster/${viewId}`);
    revalidatePath('/inbox');
    revalidatePath('/');
    return { kind: 'dissolved', released };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { kind: 'error', message };
  }
}
