// 등록된 프로젝트 (레포) 의 자동 머지 정책 토글. Phase 8 인테이크 마법사가 들어오기 전
// 임시 settings UI 에서 사용. installation 있는 프로젝트만 토글 대상 (seed 데이터 제외).

import { eq, isNotNull, asc } from 'drizzle-orm';
import { db } from '@/db/client';
import { projects } from '@/db/schema';

export type ProjectAutoMergeRow = {
  id: number;
  slug: string;
  name: string;
  autoMergeEnabled: boolean;
};

// settings UI 에 노출할 목록 — installation 있는 프로젝트만.
// 시드/데모 프로젝트는 자동 머지가 의미 없어 (GitHub API 호출 불가) 숨김.
export function listAutoMergeProjects(): ProjectAutoMergeRow[] {
  return db
    .select({
      id: projects.id,
      slug: projects.slug,
      name: projects.name,
      autoMergeEnabled: projects.autoMergeEnabled,
    })
    .from(projects)
    .where(isNotNull(projects.installationId))
    .orderBy(asc(projects.slug))
    .all();
}

// 단건 토글. installation 없는 행은 의도적으로 거부 (UI 가 애초에 노출 안 함).
export type ToggleAutoMergeResult =
  | { kind: 'updated'; row: ProjectAutoMergeRow }
  | { kind: 'not-found' };

export function setProjectAutoMerge(id: number, enabled: boolean): ToggleAutoMergeResult {
  const existing = db
    .select({ installationId: projects.installationId })
    .from(projects)
    .where(eq(projects.id, id))
    .get();
  if (!existing || existing.installationId === null) {
    return { kind: 'not-found' };
  }
  const row = db
    .update(projects)
    .set({ autoMergeEnabled: enabled })
    .where(eq(projects.id, id))
    .returning({
      id: projects.id,
      slug: projects.slug,
      name: projects.name,
      autoMergeEnabled: projects.autoMergeEnabled,
    })
    .get();
  return { kind: 'updated', row };
}
