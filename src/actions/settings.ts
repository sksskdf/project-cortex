'use server';

// 설정 토글 Server Action. AI on/off 가 즉시 sync.ts 호출에 반영되도록
// 모든 lib 호출처가 매번 getSettings() 를 읽음.

import { revalidatePath } from 'next/cache';
import { installCortexSkill } from '@/lib/cortex-skill';
import { setProjectAutoMerge } from '@/lib/projects';
import { reconcileProject, type ReconcileResult } from '@/lib/reconcile';
import { reapplyRoadmapMatchesForProject } from '@/lib/roadmap';
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

// Phase 13.6 — Cortex 워크플로 스킬을 ~/.claude/skills/cortex 에 설치/업데이트.
// 설치하면 모든 claude 세션(불러온 프로젝트 포함)에서 Cortex 컨벤션을 on-demand 로 참조.
export type InstallSkillActionState =
  | { kind: 'installed'; path: string }
  | { kind: 'up-to-date'; path: string }
  | { kind: 'error'; message: string };

export async function installCortexSkillAction(): Promise<InstallSkillActionState> {
  try {
    return installCortexSkill();
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

// 프로젝트별 자동 머지 정책 토글 — Phase 8 인테이크 마법사 전 임시 UI 에서 호출.
// 토글 즉시 DB 반영 → 다음 webhook 부터 triage 룰 #2 통과 가능.
export type ProjectAutoMergeActionState =
  | { kind: 'idle' }
  | { kind: 'updated'; id: number; enabled: boolean; retriagedCount: number }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string };

export async function toggleProjectAutoMergeAction(
  id: number,
  enabled: boolean,
): Promise<ProjectAutoMergeActionState> {
  try {
    const result = await setProjectAutoMerge(id, enabled);
    revalidatePath('/settings');
    revalidatePath('/inbox');
    revalidatePath('/');
    if (result.kind === 'not-found') return { kind: 'not-found' };
    return {
      kind: 'updated',
      id: result.row.id,
      enabled: result.row.autoMergeEnabled,
      retriagedCount: result.retriagedPrIds.length,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { kind: 'error', message };
  }
}

// 사용자가 /settings 의 'GitHub 와 동기화' 버튼 누른 흐름. listOpenPullRequests + upsert.
// AI 분석 명시 bypass — 크레딧 0. 사용자가 PR 상세에서 명시 요청해야 분석.
export type ReconcileActionState =
  | { kind: 'idle' }
  | {
      kind: 'reconciled';
      slug: string;
      total: number;
      inserted: number;
      updated: number;
      skipped: number;
      failed: number;
    }
  | { kind: 'skipped'; message: string }
  | { kind: 'error'; message: string };

export async function reconcileProjectAction(projectId: number): Promise<ReconcileActionState> {
  let result: ReconcileResult;
  try {
    result = await reconcileProject(projectId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { kind: 'error', message };
  }

  // reconcile 이 머지된 PR 들을 upsert 한 후 로드맵 매칭 backfill 1회 발화.
  // wire-up 전 머지된 PR 들 + body 마커 있는데 매칭 안 된 PR 들 모두 채움.
  // cascade 가드 (doneByPrId IS NULL) 로 idempotent — 두 번 클릭해도 안전.
  try {
    reapplyRoadmapMatchesForProject(projectId);
  } catch (err) {
    console.error(`reapplyRoadmapMatchesForProject failed for project ${projectId}:`, err);
  }

  revalidatePath('/settings');
  revalidatePath('/inbox');
  revalidatePath('/');
  revalidatePath(`/projects/${projectId}/roadmap`);
  revalidatePath('/projects');

  if (result.kind === 'reconciled') {
    return {
      kind: 'reconciled',
      slug: result.slug,
      total: result.total,
      inserted: result.inserted,
      updated: result.updated,
      skipped: result.skipped,
      failed: result.failed,
    };
  }
  if (result.kind === 'failed') return { kind: 'error', message: result.reason };
  return {
    kind: 'skipped',
    message:
      result.reason === 'no-project'
        ? '프로젝트를 찾을 수 없습니다.'
        : 'GitHub App 설치 정보가 없습니다.',
  };
}
