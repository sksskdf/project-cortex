'use server';

// Phase 8 — 수동 레포 등록 Server Action.

import { revalidatePath } from 'next/cache';
import { addProjectManually, type AddProjectResult } from '@/lib/projects';

export type AddProjectActionState =
  | { kind: 'idle' }
  | AddProjectResult
  | { kind: 'error'; message: string };

export async function addProjectAction(input: {
  slug: string;
  name?: string;
}): Promise<AddProjectActionState> {
  try {
    const r = addProjectManually(input);
    if (r.kind === 'added') {
      revalidatePath('/projects');
      revalidatePath('/');
    }
    return r;
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}
