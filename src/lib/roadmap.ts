// Phase 10 — 프로젝트별 로드맵 CRUD + PR 머지 시 자동 done 매핑.
//
// 사용자가 docs/ROADMAP.md 같은 형태로 각 프로젝트의 Phase·산출물을 등록.
// PR 본문에 'Closes #PHASE-3' 또는 'Closes #ITEM-12' 같은 컨벤션을 적으면
// 머지 시 해당 Phase / item 이 자동 done 으로 전환.

import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db/client';
import { projects, prs, roadmapItems, roadmapPhases, type RoadmapItemRow } from '@/db/schema';

export type RoadmapStatus = 'planned' | 'in-progress' | 'done';

export type RoadmapItemView = {
  id: number;
  phaseId: number;
  title: string;
  note: string | null;
  status: RoadmapStatus;
  doneByPrId: number | null;
  sortOrder: number;
};

export type RoadmapPhaseView = {
  id: number;
  projectId: number;
  key: string;
  title: string;
  goal: string | null;
  status: RoadmapStatus;
  sortOrder: number;
  items: RoadmapItemView[];
  // 진척 계산 — items 의 done 비율 (정수 %). items 가 0 개면 phase.status 기반.
  progressPct: number;
};

export type ProjectRoadmapView = {
  projectId: number;
  projectSlug: string;
  projectName: string;
  phases: RoadmapPhaseView[];
  // 프로젝트 전체 진척 — 모든 phase 의 items 의 done 비율 가중 평균.
  // items 가 하나도 없으면 phases.done / phases.total.
  overallPct: number;
};

function rowToItemView(row: RoadmapItemRow): RoadmapItemView {
  return {
    id: row.id,
    phaseId: row.phaseId,
    title: row.title,
    note: row.note,
    status: row.status as RoadmapStatus,
    doneByPrId: row.doneByPrId,
    sortOrder: row.sortOrder,
  };
}

function calcPhaseProgress(items: RoadmapItemView[], phaseStatus: RoadmapStatus): number {
  if (items.length === 0) {
    return phaseStatus === 'done' ? 100 : phaseStatus === 'in-progress' ? 50 : 0;
  }
  const doneCount = items.filter((i) => i.status === 'done').length;
  return Math.round((doneCount / items.length) * 100);
}

export function getProjectRoadmap(projectId: number): ProjectRoadmapView | null {
  const project = db
    .select({ id: projects.id, slug: projects.slug, name: projects.name })
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();
  if (!project) return null;

  const phaseRows = db
    .select()
    .from(roadmapPhases)
    .where(eq(roadmapPhases.projectId, projectId))
    .orderBy(asc(roadmapPhases.sortOrder), asc(roadmapPhases.id))
    .all();

  const phaseIds = phaseRows.map((p) => p.id);
  const itemRows =
    phaseIds.length > 0
      ? db
          .select()
          .from(roadmapItems)
          .where(inArray(roadmapItems.phaseId, phaseIds))
          .orderBy(asc(roadmapItems.sortOrder), asc(roadmapItems.id))
          .all()
      : [];

  const itemsByPhase = new Map<number, RoadmapItemView[]>();
  for (const it of itemRows) {
    const list = itemsByPhase.get(it.phaseId) ?? [];
    list.push(rowToItemView(it));
    itemsByPhase.set(it.phaseId, list);
  }

  const phases: RoadmapPhaseView[] = phaseRows.map((p) => {
    const items = itemsByPhase.get(p.id) ?? [];
    return {
      id: p.id,
      projectId: p.projectId,
      key: p.key,
      title: p.title,
      goal: p.goal,
      status: p.status as RoadmapStatus,
      sortOrder: p.sortOrder,
      items,
      progressPct: calcPhaseProgress(items, p.status as RoadmapStatus),
    };
  });

  // 프로젝트 전체 진척 — 전체 items 의 done 비율. items 0 이면 phases.done / phases.total.
  const allItems = phases.flatMap((p) => p.items);
  let overallPct = 0;
  if (allItems.length > 0) {
    const doneItems = allItems.filter((i) => i.status === 'done').length;
    overallPct = Math.round((doneItems / allItems.length) * 100);
  } else if (phases.length > 0) {
    const donePhases = phases.filter((p) => p.status === 'done').length;
    overallPct = Math.round((donePhases / phases.length) * 100);
  }

  return {
    projectId: project.id,
    projectSlug: project.slug,
    projectName: project.name,
    phases,
    overallPct,
  };
}

// 대시보드 / 프로젝트 카드용 — phases / items 디테일 없이 전체 진척 % 만.
export type ProjectProgress = {
  projectId: number;
  overallPct: number;
  phaseCount: number;
  donePhaseCount: number;
};

export function getProjectProgress(projectId: number): ProjectProgress {
  const phaseRows = db
    .select({ id: roadmapPhases.id, status: roadmapPhases.status })
    .from(roadmapPhases)
    .where(eq(roadmapPhases.projectId, projectId))
    .all();

  if (phaseRows.length === 0) {
    return { projectId, overallPct: 0, phaseCount: 0, donePhaseCount: 0 };
  }

  const phaseIds = phaseRows.map((p) => p.id);
  const itemRows = db
    .select({ status: roadmapItems.status })
    .from(roadmapItems)
    .where(inArray(roadmapItems.phaseId, phaseIds))
    .all();

  const donePhaseCount = phaseRows.filter((p) => p.status === 'done').length;
  let overallPct = 0;
  if (itemRows.length > 0) {
    const doneItems = itemRows.filter((i) => i.status === 'done').length;
    overallPct = Math.round((doneItems / itemRows.length) * 100);
  } else {
    overallPct = Math.round((donePhaseCount / phaseRows.length) * 100);
  }

  return {
    projectId,
    overallPct,
    phaseCount: phaseRows.length,
    donePhaseCount,
  };
}

// CRUD — server actions 가 호출하는 동기 함수들.

export function createPhase(input: {
  projectId: number;
  key: string;
  title: string;
  goal?: string | null;
}): { kind: 'created'; id: number } | { kind: 'duplicate-key' } | { kind: 'no-project' } {
  const project = db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .get();
  if (!project) return { kind: 'no-project' };

  const existing = db
    .select({ id: roadmapPhases.id })
    .from(roadmapPhases)
    .where(and(eq(roadmapPhases.projectId, input.projectId), eq(roadmapPhases.key, input.key)))
    .get();
  if (existing) return { kind: 'duplicate-key' };

  // 끝에 추가 — 같은 project 의 max sortOrder + 1.
  const maxOrder = db
    .select({ s: roadmapPhases.sortOrder })
    .from(roadmapPhases)
    .where(eq(roadmapPhases.projectId, input.projectId))
    .orderBy(asc(roadmapPhases.sortOrder))
    .all();
  const nextOrder = maxOrder.length === 0 ? 0 : Math.max(...maxOrder.map((r) => r.s)) + 1;

  const row = db
    .insert(roadmapPhases)
    .values({
      projectId: input.projectId,
      key: input.key,
      title: input.title,
      goal: input.goal ?? null,
      sortOrder: nextOrder,
    })
    .returning({ id: roadmapPhases.id })
    .get();
  return { kind: 'created', id: row.id };
}

export function updatePhaseStatus(
  phaseId: number,
  status: RoadmapStatus,
): { kind: 'updated' } | { kind: 'not-found' } {
  const existing = db
    .select({ id: roadmapPhases.id })
    .from(roadmapPhases)
    .where(eq(roadmapPhases.id, phaseId))
    .get();
  if (!existing) return { kind: 'not-found' };
  db.update(roadmapPhases)
    .set({ status, updatedAt: new Date() })
    .where(eq(roadmapPhases.id, phaseId))
    .run();
  return { kind: 'updated' };
}

export function deletePhase(phaseId: number): { kind: 'deleted' } | { kind: 'not-found' } {
  const existing = db
    .select({ id: roadmapPhases.id })
    .from(roadmapPhases)
    .where(eq(roadmapPhases.id, phaseId))
    .get();
  if (!existing) return { kind: 'not-found' };
  // items 먼저 제거 (FK).
  db.delete(roadmapItems).where(eq(roadmapItems.phaseId, phaseId)).run();
  db.delete(roadmapPhases).where(eq(roadmapPhases.id, phaseId)).run();
  return { kind: 'deleted' };
}

export function createItem(input: {
  phaseId: number;
  title: string;
}): { kind: 'created'; id: number } | { kind: 'no-phase' } {
  const phase = db
    .select({ id: roadmapPhases.id })
    .from(roadmapPhases)
    .where(eq(roadmapPhases.id, input.phaseId))
    .get();
  if (!phase) return { kind: 'no-phase' };

  const maxOrder = db
    .select({ s: roadmapItems.sortOrder })
    .from(roadmapItems)
    .where(eq(roadmapItems.phaseId, input.phaseId))
    .all();
  const nextOrder = maxOrder.length === 0 ? 0 : Math.max(...maxOrder.map((r) => r.s)) + 1;

  const row = db
    .insert(roadmapItems)
    .values({
      phaseId: input.phaseId,
      title: input.title,
      sortOrder: nextOrder,
    })
    .returning({ id: roadmapItems.id })
    .get();
  return { kind: 'created', id: row.id };
}

export function toggleItemStatus(
  itemId: number,
  status: RoadmapStatus,
): { kind: 'updated' } | { kind: 'not-found' } {
  const existing = db
    .select({ id: roadmapItems.id })
    .from(roadmapItems)
    .where(eq(roadmapItems.id, itemId))
    .get();
  if (!existing) return { kind: 'not-found' };
  // 수동 toggle 이면 doneByPrId 는 null 로 (자동 done 추적 끊김).
  db.update(roadmapItems)
    .set({ status, doneByPrId: null, updatedAt: new Date() })
    .where(eq(roadmapItems.id, itemId))
    .run();
  return { kind: 'updated' };
}

export function deleteItem(itemId: number): { kind: 'deleted' } | { kind: 'not-found' } {
  const existing = db
    .select({ id: roadmapItems.id })
    .from(roadmapItems)
    .where(eq(roadmapItems.id, itemId))
    .get();
  if (!existing) return { kind: 'not-found' };
  db.delete(roadmapItems).where(eq(roadmapItems.id, itemId)).run();
  return { kind: 'deleted' };
}

// PR 본문에서 'Closes #PHASE-<key>' 또는 'Closes #ITEM-<id>' 패턴을 추출.
// GitHub PR description 컨벤션. case-insensitive, 'Fixes' / 'Resolves' 도 인식.
// 같은 PR 에 여러 매칭 가능.
const PHASE_KEY_PATTERN = /(?:Closes|Fixes|Resolves)\s+#PHASE-([A-Za-z0-9_-]+)/gi;
const ITEM_ID_PATTERN = /(?:Closes|Fixes|Resolves)\s+#ITEM-(\d+)/gi;

export type RoadmapMatchResult = {
  phasesDone: number[]; // phase id 들
  itemsDone: number[]; // item id 들
};

// PR 머지 직후 호출. body 의 컨벤션 매칭으로 해당 Phase / item 을 done 으로 전환.
// 매칭된 id 는 같은 project 의 것만 — cross-project orphan 방지.
export function matchAndApplyDoneFromPR(prId: number): RoadmapMatchResult {
  const pr = db
    .select({ id: prs.id, repoId: prs.repoId, body: prs.body })
    .from(prs)
    .where(eq(prs.id, prId))
    .get();
  if (!pr || !pr.body) return { phasesDone: [], itemsDone: [] };

  // Phase key 매칭.
  const phaseKeys = new Set<string>();
  for (const m of pr.body.matchAll(PHASE_KEY_PATTERN)) {
    phaseKeys.add(m[1]);
  }
  // Item id 매칭.
  const itemIds = new Set<number>();
  for (const m of pr.body.matchAll(ITEM_ID_PATTERN)) {
    const n = Number(m[1]);
    if (!Number.isNaN(n)) itemIds.add(n);
  }
  if (phaseKeys.size === 0 && itemIds.size === 0) return { phasesDone: [], itemsDone: [] };

  // 같은 project 의 phase 만.
  const matchedPhases =
    phaseKeys.size > 0
      ? db
          .select({ id: roadmapPhases.id })
          .from(roadmapPhases)
          .where(
            and(eq(roadmapPhases.projectId, pr.repoId), inArray(roadmapPhases.key, [...phaseKeys])),
          )
          .all()
      : [];

  for (const p of matchedPhases) {
    db.update(roadmapPhases)
      .set({ status: 'done', updatedAt: new Date() })
      .where(eq(roadmapPhases.id, p.id))
      .run();
  }

  // 같은 project 의 phase 에 속한 item 만 done 으로 (orphan 방지).
  const matchedItems =
    itemIds.size > 0
      ? db
          .select({ id: roadmapItems.id, phaseProjectId: roadmapPhases.projectId })
          .from(roadmapItems)
          .innerJoin(roadmapPhases, eq(roadmapPhases.id, roadmapItems.phaseId))
          .where(
            and(inArray(roadmapItems.id, [...itemIds]), eq(roadmapPhases.projectId, pr.repoId)),
          )
          .all()
      : [];

  for (const it of matchedItems) {
    db.update(roadmapItems)
      .set({ status: 'done', doneByPrId: prId, updatedAt: new Date() })
      .where(eq(roadmapItems.id, it.id))
      .run();
  }

  return {
    phasesDone: matchedPhases.map((p) => p.id),
    itemsDone: matchedItems.map((i) => i.id),
  };
}

// PR 상세에 노출되는 미니 배지 — 이 PR 이 연결된 phase / item 목록.
export type PRRoadmapLink = {
  kind: 'phase' | 'item';
  id: number;
  phaseKey: string;
  title: string;
  // PR 머지 후 자동 done 됐는지 (item 만 doneByPrId 추적).
  autoDone: boolean;
};

export function getPRRoadmapLinks(prId: number): PRRoadmapLink[] {
  const pr = db
    .select({ id: prs.id, repoId: prs.repoId, body: prs.body })
    .from(prs)
    .where(eq(prs.id, prId))
    .get();
  if (!pr || !pr.body) return [];

  const phaseKeys = new Set<string>();
  for (const m of pr.body.matchAll(PHASE_KEY_PATTERN)) phaseKeys.add(m[1]);
  const itemIds = new Set<number>();
  for (const m of pr.body.matchAll(ITEM_ID_PATTERN)) {
    const n = Number(m[1]);
    if (!Number.isNaN(n)) itemIds.add(n);
  }
  if (phaseKeys.size === 0 && itemIds.size === 0) return [];

  const phaseLinks: PRRoadmapLink[] =
    phaseKeys.size > 0
      ? db
          .select({
            id: roadmapPhases.id,
            key: roadmapPhases.key,
            title: roadmapPhases.title,
          })
          .from(roadmapPhases)
          .where(
            and(eq(roadmapPhases.projectId, pr.repoId), inArray(roadmapPhases.key, [...phaseKeys])),
          )
          .all()
          .map((p) => ({
            kind: 'phase' as const,
            id: p.id,
            phaseKey: p.key,
            title: p.title,
            autoDone: false,
          }))
      : [];

  const itemLinks: PRRoadmapLink[] =
    itemIds.size > 0
      ? db
          .select({
            id: roadmapItems.id,
            title: roadmapItems.title,
            doneByPrId: roadmapItems.doneByPrId,
            phaseKey: roadmapPhases.key,
          })
          .from(roadmapItems)
          .innerJoin(roadmapPhases, eq(roadmapPhases.id, roadmapItems.phaseId))
          .where(
            and(inArray(roadmapItems.id, [...itemIds]), eq(roadmapPhases.projectId, pr.repoId)),
          )
          .all()
          .map((it) => ({
            kind: 'item' as const,
            id: it.id,
            phaseKey: it.phaseKey,
            title: it.title,
            autoDone: it.doneByPrId === prId,
          }))
      : [];

  return [...phaseLinks, ...itemLinks];
}
