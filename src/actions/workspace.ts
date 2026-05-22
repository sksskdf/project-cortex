'use server';

// Phase 12 — 로컬 워크스페이스 등록 / git pull Server Actions.

import { revalidatePath } from 'next/cache';
import {
  deleteWorkspace,
  pullWorkspace,
  registerWorkspace,
  type PullResult,
  type RegisterWorkspaceResult,
} from '@/lib/workspace';

export type WorkspaceActionState =
  | { kind: 'idle' }
  | RegisterWorkspaceResult
  | { kind: 'deleted' }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string };

function revalidateProject(projectId: number) {
  revalidatePath('/projects');
  revalidatePath(`/projects/${projectId}/roadmap`);
}

export async function registerWorkspaceAction(input: {
  projectId: number;
  localPath: string;
}): Promise<WorkspaceActionState> {
  try {
    const r = registerWorkspace(input);
    if (r.kind === 'registered' || r.kind === 'updated') revalidateProject(input.projectId);
    return r;
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

export async function deleteWorkspaceAction(input: {
  projectId: number;
  workspaceId: number;
}): Promise<WorkspaceActionState> {
  try {
    const r = deleteWorkspace(input.workspaceId);
    if (r.kind === 'deleted') revalidateProject(input.projectId);
    return r;
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

export type PullActionState = { kind: 'idle' } | PullResult | { kind: 'error'; message: string };

export async function pullWorkspaceAction(projectId: number): Promise<PullActionState> {
  try {
    const r = await pullWorkspace(projectId);
    revalidateProject(projectId);
    return r;
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}
