'use server';

// Phase 8 — 레포 등록 Server Actions: 수동 슬러그 등록 + App 설치 리포 import.

import { revalidatePath } from 'next/cache';
import {
  addProjectFromInstallation,
  addProjectManually,
  type AddInstalledResult,
  type AddProjectResult,
} from '@/lib/projects';
import {
  listAppInstallationRepos,
  type ImportNote,
  type InstallationWithRepos,
} from '@/lib/github';

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

// Phase 8 — Cortex GitHub App 이 설치된 installation 의 접근 가능 리포 목록.
// /projects 의 "App 설치 리포에서 가져오기" UI 가 호출.
export type ListInstalledReposActionState =
  | { kind: 'ok'; installations: InstallationWithRepos[]; notes: ImportNote[] }
  | { kind: 'error'; message: string };

export async function listInstalledReposAction(): Promise<ListInstalledReposActionState> {
  try {
    const { installations, notes } = await listAppInstallationRepos();
    return { kind: 'ok', installations, notes };
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

// Phase 8 — 선택한 App 설치 리포 1건을 등록. 이미 있는 slug 에 installationId 가 null 이면
// 채워서 link, 이미 같은 installationId 면 already-linked. 새 slug 면 added.
export type AddInstalledRepoActionState =
  | { kind: 'idle' }
  | AddInstalledResult
  | { kind: 'error'; message: string };

export async function addInstalledRepoAction(input: {
  slug: string;
  name?: string;
  installationId: number;
  appConfigId?: number | null;
}): Promise<AddInstalledRepoActionState> {
  try {
    const r = addProjectFromInstallation(input);
    if (r.kind === 'added' || r.kind === 'linked') {
      revalidatePath('/projects');
      revalidatePath('/');
    }
    return r;
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}
