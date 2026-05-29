'use server';

// 설정 토글 Server Action. AI on/off 가 즉시 sync.ts 호출에 반영되도록
// 모든 lib 호출처가 매번 getSettings() 를 읽음.

import { revalidatePath } from 'next/cache';
import { installCortexSkill } from '@/lib/cortex-skill';
import {
  createGithubApp,
  deleteGithubApp,
  updateGithubApp,
  type SaveAppInput,
} from '@/lib/github-apps';
import {
  setProjectAiReview,
  setProjectAutoDeleteBranch,
  setProjectAutoFixTests,
  setProjectAutoMerge,
  setProjectAutoResolveChanges,
  setProjectAutoResolveConflicts,
  setProjectMuted,
} from '@/lib/projects';
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

// Phase 8.x — GitHub App 다중 설정 CRUD. private key 는 평문 저장(localhost 단일 사용자).
export type GithubAppActionState =
  | { kind: 'created'; id: number }
  | { kind: 'updated'; id: number }
  | { kind: 'deleted' }
  | { kind: 'not-found' }
  | { kind: 'invalid'; reason: string }
  | { kind: 'duplicate-name' }
  | { kind: 'error'; message: string };

export async function createGithubAppAction(input: SaveAppInput): Promise<GithubAppActionState> {
  try {
    const r = createGithubApp(input);
    if (r.kind === 'created') revalidatePath('/settings');
    return r;
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

export async function updateGithubAppAction(
  id: number,
  input: SaveAppInput,
): Promise<GithubAppActionState> {
  try {
    const r = updateGithubApp(id, input);
    if (r.kind === 'updated') revalidatePath('/settings');
    return r;
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

export async function deleteGithubAppAction(id: number): Promise<GithubAppActionState> {
  try {
    const r = deleteGithubApp(id);
    if (r.kind === 'deleted') revalidatePath('/settings');
    return r;
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
    // 자동 머지 토글은 /projects 카드에 있다 — /projects 를 revalidate 해야 토글 상태가 새로고침
    // 되어 낙관적 값이 되돌아가지 않는다(과거 /settings 위치의 잔재 수정). /inbox·/ 도 영향.
    revalidatePath('/projects');
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

// 프로젝트별 브랜치 자동 삭제 토글. 디폴트 OFF — 회사 레포 보호.
export type ProjectBranchDeleteActionState =
  | { kind: 'idle' }
  | { kind: 'updated'; id: number; enabled: boolean }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string };

export async function toggleProjectAutoDeleteBranchAction(
  id: number,
  enabled: boolean,
): Promise<ProjectBranchDeleteActionState> {
  try {
    const result = setProjectAutoDeleteBranch(id, enabled);
    if (result.kind === 'not-found') return { kind: 'not-found' };
    revalidatePath('/projects');
    revalidatePath('/');
    return { kind: 'updated', id: result.id, enabled: result.enabled };
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

// 프로젝트 뮤트 토글. muted=true 면 webhook 무시(인박스/관리 차단), false 면 관리 재개.
export type ProjectMuteActionState =
  | { kind: 'idle' }
  | { kind: 'updated'; id: number; muted: boolean }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string };

export async function toggleProjectMutedAction(
  id: number,
  muted: boolean,
): Promise<ProjectMuteActionState> {
  try {
    const result = setProjectMuted(id, muted);
    if (result.kind === 'not-found') return { kind: 'not-found' };
    revalidatePath('/projects');
    revalidatePath('/inbox');
    revalidatePath('/');
    return { kind: 'updated', id: result.id, muted: result.muted };
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

// 프로젝트별 AI 사전 리뷰 토글. 디폴트 ON — 전역 AI 토글과 AND.
export type ProjectAiReviewActionState =
  | { kind: 'idle' }
  | { kind: 'updated'; id: number; enabled: boolean }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string };

export async function toggleProjectAiReviewAction(
  id: number,
  enabled: boolean,
): Promise<ProjectAiReviewActionState> {
  try {
    const result = setProjectAiReview(id, enabled);
    if (result.kind === 'not-found') return { kind: 'not-found' };
    revalidatePath('/projects');
    revalidatePath('/');
    return { kind: 'updated', id: result.id, enabled: result.enabled };
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

// 프로젝트별 머지 충돌 자동 해결 토글 (Phase 13.2). 디폴트 OFF — 명시적으로 켜야 발화.
export type ProjectAutoResolveActionState =
  | { kind: 'idle' }
  | { kind: 'updated'; id: number; enabled: boolean }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string };

export async function toggleProjectAutoResolveConflictsAction(
  id: number,
  enabled: boolean,
): Promise<ProjectAutoResolveActionState> {
  try {
    const result = setProjectAutoResolveConflicts(id, enabled);
    if (result.kind === 'not-found') return { kind: 'not-found' };
    revalidatePath('/projects');
    revalidatePath('/');
    return { kind: 'updated', id: result.id, enabled: result.enabled };
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

// 프로젝트별 CI 테스트 실패 자동 수정 토글 (Phase 13.3). 디폴트 OFF.
export type ProjectAutoFixTestsActionState =
  | { kind: 'idle' }
  | { kind: 'updated'; id: number; enabled: boolean }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string };

export async function toggleProjectAutoFixTestsAction(
  id: number,
  enabled: boolean,
): Promise<ProjectAutoFixTestsActionState> {
  try {
    const result = setProjectAutoFixTests(id, enabled);
    if (result.kind === 'not-found') return { kind: 'not-found' };
    revalidatePath('/projects');
    revalidatePath('/');
    return { kind: 'updated', id: result.id, enabled: result.enabled };
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

// 프로젝트별 변경 요청 리뷰 자동 반영 토글 (Phase 13.1). 디폴트 OFF.
export type ProjectAutoResolveChangesActionState =
  | { kind: 'idle' }
  | { kind: 'updated'; id: number; enabled: boolean }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string };

export async function toggleProjectAutoResolveChangesAction(
  id: number,
  enabled: boolean,
): Promise<ProjectAutoResolveChangesActionState> {
  try {
    const result = setProjectAutoResolveChanges(id, enabled);
    if (result.kind === 'not-found') return { kind: 'not-found' };
    revalidatePath('/projects');
    revalidatePath('/');
    return { kind: 'updated', id: result.id, enabled: result.enabled };
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
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
