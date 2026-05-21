'use server';

// 설정 토글 Server Action. AI on/off 가 즉시 sync.ts 호출에 반영되도록
// 모든 lib 호출처가 매번 getSettings() 를 읽음.

import { revalidatePath } from 'next/cache';
import { setProjectAutoMerge } from '@/lib/projects';
import { setAiEnabled } from '@/lib/settings';

export type SettingsActionState =
  | { kind: 'idle' }
  | { kind: 'updated'; aiEnabled: boolean }
  | { kind: 'error'; message: string };

export async function toggleAiEnabledAction(enabled: boolean): Promise<SettingsActionState> {
  try {
    const row = setAiEnabled(enabled);
    revalidatePath('/settings');
    revalidatePath('/');
    return { kind: 'updated', aiEnabled: row.aiEnabled };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { kind: 'error', message };
  }
}

// 프로젝트별 자동 머지 정책 토글 — Phase 8 인테이크 마법사 전 임시 UI 에서 호출.
// 토글 즉시 DB 반영 → 다음 webhook 부터 triage 룰 #2 통과 가능.
export type ProjectAutoMergeActionState =
  | { kind: 'idle' }
  | { kind: 'updated'; id: number; enabled: boolean }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string };

export async function toggleProjectAutoMergeAction(
  id: number,
  enabled: boolean,
): Promise<ProjectAutoMergeActionState> {
  try {
    const result = setProjectAutoMerge(id, enabled);
    revalidatePath('/settings');
    if (result.kind === 'not-found') return { kind: 'not-found' };
    return { kind: 'updated', id: result.row.id, enabled: result.row.autoMergeEnabled };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { kind: 'error', message };
  }
}
