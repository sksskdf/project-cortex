'use server';

// Phase 10.1 — .cortex/ 동기화 Server Action.
// 사용자가 /projects/[id]/roadmap 헤더의 "동기화" 버튼 누르면 호출.
// 첫 onboard 시점에 백그라운드로 호출되는 흐름은 별도 (autoSyncOnFirstView).

import { revalidatePath } from 'next/cache';
import { syncProjectFromGit, type SyncResult } from '@/lib/project-meta';
import { pushRoadmapToGit, type PushRoadmapResult } from '@/lib/roadmap-sync';
import { setProjectRoadmapAutoSync } from '@/lib/projects';

export type SyncActionState = { kind: 'idle' } | SyncResult | { kind: 'error'; message: string };

export async function syncProjectMetaAction(projectId: number): Promise<SyncActionState> {
  try {
    const result = await syncProjectFromGit(projectId);
    if (result.kind === 'synced') {
      revalidatePath(`/projects/${projectId}/roadmap`);
      revalidatePath('/projects');
      revalidatePath('/');
    }
    return result;
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

// Phase 10.4 — Cortex UI 로드맵(DB)을 git `.cortex/roadmap.md` 로 PR 생성(수동 push 방향).
export type PushRoadmapActionState =
  | { kind: 'idle' }
  | PushRoadmapResult
  | { kind: 'error'; message: string };

export async function pushRoadmapToGitAction(projectId: number): Promise<PushRoadmapActionState> {
  try {
    return await pushRoadmapToGit(projectId);
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

// Phase 10.4 — UI 편집 자동 git sync 토글(프로젝트별, 기본 OFF).
export type RoadmapAutoSyncToggleState =
  | { kind: 'idle' }
  | { kind: 'updated'; enabled: boolean }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string };

export async function toggleRoadmapAutoSyncAction(
  projectId: number,
  enabled: boolean,
): Promise<RoadmapAutoSyncToggleState> {
  try {
    const r = setProjectRoadmapAutoSync(projectId, enabled);
    if (r.kind === 'not-found') return { kind: 'not-found' };
    revalidatePath(`/projects/${projectId}/roadmap`);
    return { kind: 'updated', enabled: r.enabled };
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}
