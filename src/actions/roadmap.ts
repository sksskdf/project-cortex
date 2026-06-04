'use server';

// Phase 10 — 로드맵 Phase / item CRUD + 상태 토글 Server Actions.
// revalidatePath 로 /projects/[id]/roadmap 갱신.

import { revalidatePath } from 'next/cache';
import {
  createItem,
  createPhase,
  deleteItem,
  deletePhase,
  toggleItemStatus,
  updateItemTitle,
  updatePhaseStatus,
  type RoadmapStatus,
} from '@/lib/roadmap';
import { autoSyncRoadmapIfEnabled } from '@/lib/roadmap-sync';

export type RoadmapActionState =
  | { kind: 'idle' }
  | { kind: 'created'; id: number }
  | { kind: 'updated' }
  | { kind: 'deleted' }
  | { kind: 'duplicate-key' }
  | { kind: 'not-found' }
  | { kind: 'no-project' }
  | { kind: 'no-phase' }
  | { kind: 'error'; message: string };

function revalidateAll(projectId: number) {
  revalidatePath(`/projects/${projectId}/roadmap`);
  revalidatePath(`/projects`);
  revalidatePath('/');
  // Phase 10.4 — UI 로드맵 편집이 성공하면 자동 git sync(roadmapAutoSyncEnabled ON 인 프로젝트만).
  // fire-and-forget·롤링 PR 누적이라 편집마다 호출해도 안전(스팸 없음). OFF 면 즉시 no-op.
  autoSyncRoadmapIfEnabled(projectId);
}

export async function createPhaseAction(input: {
  projectId: number;
  key: string;
  title: string;
  goal?: string | null;
}): Promise<RoadmapActionState> {
  try {
    const key = input.key.trim();
    const title = input.title.trim();
    if (!key || !title) return { kind: 'error', message: '키와 제목은 필수입니다.' };
    const r = createPhase({ ...input, key, title });
    if (r.kind === 'created') {
      revalidateAll(input.projectId);
      return { kind: 'created', id: r.id };
    }
    return r;
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

export async function updatePhaseStatusAction(
  projectId: number,
  phaseId: number,
  status: RoadmapStatus,
): Promise<RoadmapActionState> {
  try {
    const r = updatePhaseStatus(phaseId, status);
    if (r.kind === 'updated') revalidateAll(projectId);
    return r;
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

export async function deletePhaseAction(
  projectId: number,
  phaseId: number,
): Promise<RoadmapActionState> {
  try {
    const r = deletePhase(phaseId);
    if (r.kind === 'deleted') revalidateAll(projectId);
    return r;
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

export async function createItemAction(input: {
  projectId: number;
  phaseId: number;
  title: string;
}): Promise<RoadmapActionState> {
  try {
    const title = input.title.trim();
    if (!title) return { kind: 'error', message: '제목은 필수입니다.' };
    const r = createItem({ phaseId: input.phaseId, title });
    if (r.kind === 'created') {
      revalidateAll(input.projectId);
      return { kind: 'created', id: r.id };
    }
    return r;
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

export async function toggleItemStatusAction(
  projectId: number,
  itemId: number,
  status: RoadmapStatus,
): Promise<RoadmapActionState> {
  try {
    const r = toggleItemStatus(itemId, status);
    if (r.kind === 'updated') revalidateAll(projectId);
    return r;
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

export async function updateItemTitleAction(
  projectId: number,
  itemId: number,
  title: string,
): Promise<RoadmapActionState> {
  try {
    const r = updateItemTitle(itemId, title);
    if (r.kind === 'invalid') return { kind: 'error', message: '제목은 필수입니다.' };
    if (r.kind === 'updated') revalidateAll(projectId);
    return r;
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

export async function deleteItemAction(
  projectId: number,
  itemId: number,
): Promise<RoadmapActionState> {
  try {
    const r = deleteItem(itemId);
    if (r.kind === 'deleted') revalidateAll(projectId);
    return r;
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}
