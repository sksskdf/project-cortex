// Phase 10 — 프로젝트별 로드맵 CRUD + PR 머지 시 자동 done 매핑.
//
// 사용자가 docs/ROADMAP.md 같은 형태로 각 프로젝트의 Phase·산출물을 등록.
// PR 본문에 'Closes #PHASE-3' 또는 'Closes #ITEM-12' 같은 컨벤션을 적으면
// 머지 시 해당 Phase / item 이 자동 done 으로 전환.

import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { db } from '@/db/client';
import { projects, prs, roadmapItems, roadmapPhases, type RoadmapItemRow } from '@/db/schema';

export type RoadmapStatus = 'planned' | 'in-progress' | 'done';
export type RoadmapSource = 'git' | 'manual';

export type RoadmapItemView = {
  id: number;
  phaseId: number;
  title: string;
  note: string | null;
  status: RoadmapStatus;
  doneByPrId: number | null;
  // GitHub PR number — UI 가 '#N' 링크 노출에 사용. doneByPrId 없으면 null.
  doneByPrNumber: number | null;
  sortOrder: number;
  // Phase 10.1 — data origin + 사용자 수정 마크.
  source: RoadmapSource;
  overridden: boolean; // sourceOverrideAt !== null
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
  source: RoadmapSource;
  overridden: boolean;
};

// Phase 10.1 — 사용자 시그널 ("남은 작업 목록을 확인할 수 있어야 함"). Phase 카드와
// 별개로 진행 중 + 예정 item 만 모은 평탄 리스트.
export type OpenItemView = {
  id: number;
  title: string;
  status: 'planned' | 'in-progress';
  phaseId: number;
  phaseKey: string;
  phaseTitle: string;
  source: RoadmapSource;
};

// Phase 10.1 후속 — 남은 작업을 Phase 별로 그룹핑 + 펼치기/접기 위한 구조.
// 사용자 시그널 (2026-05-22): 헤더는 open count, 펼치면 done 도 함께 (line-through) —
// 컨텍스트 손실 방지. 항목별 PR# 링크로 머지된 PR 상세 이동.
export type OpenItemGroupItem = {
  id: number;
  title: string;
  status: RoadmapStatus;
  doneByPrId: number | null;
  doneByPrNumber: number | null;
  source: RoadmapSource;
};

export type OpenItemGroupView = {
  phaseId: number;
  phaseKey: string;
  phaseTitle: string;
  phaseGoal: string | null;
  // 그룹 내 진행 중 + 예정 item 수 (헤더에 노출).
  openCount: number;
  // 그룹 내 전체 item 수 — 진척 표시 ('완료 N/M').
  totalCount: number;
  doneCount: number;
  // Phase 의 모든 item (done 포함, sortOrder 순서). UI 가 펼쳤을 때 표시.
  items: OpenItemGroupItem[];
};

export type ProjectRoadmapView = {
  projectId: number;
  projectSlug: string;
  projectName: string;
  phases: RoadmapPhaseView[];
  openItems: OpenItemView[];
  // Open items 를 Phase 별로 그룹핑한 뷰 — 빈 그룹 (모든 item done) 도 포함해서
  // Phase 진척 한눈 + 펼치기 가능. UI 가 collapsed by default 로 렌더.
  openItemGroups: OpenItemGroupView[];
  // 프로젝트 전체 진척 — 모든 phase 의 items 의 done 비율 가중 평균.
  // items 가 하나도 없으면 phases.done / phases.total.
  overallPct: number;
  totalItems: number;
  doneItems: number;
};

function rowToItemView(row: RoadmapItemRow, prNumberById: Map<number, number>): RoadmapItemView {
  return {
    id: row.id,
    phaseId: row.phaseId,
    title: row.title,
    note: row.note,
    status: row.status as RoadmapStatus,
    doneByPrId: row.doneByPrId,
    doneByPrNumber: row.doneByPrId !== null ? (prNumberById.get(row.doneByPrId) ?? null) : null,
    sortOrder: row.sortOrder,
    source: row.source as RoadmapSource,
    overridden: row.sourceOverrideAt !== null,
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

  // doneByPrId 매칭되는 PR 의 GitHub number — UI 가 '#N' 링크에 사용.
  const prIds = itemRows.map((it) => it.doneByPrId).filter((id): id is number => id !== null);
  const prNumberById = new Map<number, number>();
  if (prIds.length > 0) {
    const prRows = db
      .select({ id: prs.id, number: prs.number })
      .from(prs)
      .where(inArray(prs.id, prIds))
      .all();
    for (const r of prRows) prNumberById.set(r.id, r.number);
  }

  const itemsByPhase = new Map<number, RoadmapItemView[]>();
  for (const it of itemRows) {
    const list = itemsByPhase.get(it.phaseId) ?? [];
    list.push(rowToItemView(it, prNumberById));
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
      source: p.source as RoadmapSource,
      overridden: p.sourceOverrideAt !== null,
    };
  });

  // 프로젝트 전체 진척 — 전체 items 의 done 비율. items 0 이면 phases.done / phases.total.
  const allItems = phases.flatMap((p) => p.items);
  const doneCount = allItems.filter((i) => i.status === 'done').length;
  let overallPct = 0;
  if (allItems.length > 0) {
    overallPct = Math.round((doneCount / allItems.length) * 100);
  } else if (phases.length > 0) {
    const donePhases = phases.filter((p) => p.status === 'done').length;
    overallPct = Math.round((donePhases / phases.length) * 100);
  }

  // 사용자 시그널: "남은 작업 목록을 확인할 수 있어야 함". open items 만 평탄화.
  const openItems: OpenItemView[] = phases.flatMap((phase) =>
    phase.items
      .filter((it) => it.status !== 'done')
      .map((it) => ({
        id: it.id,
        title: it.title,
        status: it.status as 'planned' | 'in-progress',
        phaseId: phase.id,
        phaseKey: phase.key,
        phaseTitle: phase.title,
        source: it.source,
      })),
  );

  // Phase 별 그룹 — 헤더는 open count 만, 펼치면 phase 의 모든 item 표시 (done 은
  // line-through). 사용자 시그널 "이미 진행된 PHASE 의 항목 표시 안 됨" 헷갈림 해결.
  const openItemGroups: OpenItemGroupView[] = phases.map((phase) => {
    const doneInPhase = phase.items.filter((i) => i.status === 'done').length;
    const openInPhase = phase.items.length - doneInPhase;
    return {
      phaseId: phase.id,
      phaseKey: phase.key,
      phaseTitle: phase.title,
      phaseGoal: phase.goal,
      openCount: openInPhase,
      totalCount: phase.items.length,
      doneCount: doneInPhase,
      items: phase.items.map((it) => ({
        id: it.id,
        title: it.title,
        status: it.status,
        doneByPrId: it.doneByPrId,
        doneByPrNumber: it.doneByPrNumber,
        source: it.source,
      })),
    };
  });

  return {
    projectId: project.id,
    projectSlug: project.slug,
    projectName: project.name,
    phases,
    openItems,
    openItemGroups,
    overallPct,
    totalItems: allItems.length,
    doneItems: doneCount,
  };
}

// 대시보드 / 프로젝트 카드용 — phases / items 디테일 없이 전체 진척 % 만.
export type ProjectProgress = {
  projectId: number;
  overallPct: number;
  phaseCount: number;
  donePhaseCount: number;
};

// 대시보드 프로젝트 위젯 — 모든 active 프로젝트의 진척 한눈. 사용자 시그널 (2026-05-22):
// "대시보드에서도 프로젝트 관련 뷰잉 위젯이 있으면 좋을 것 같고".
export type DashboardProjectRow = {
  projectId: number;
  slug: string;
  name: string;
  overallPct: number;
  openItemCount: number;
  totalItems: number;
  doneItems: number;
};

export function listDashboardProjects(): DashboardProjectRow[] {
  const projectRows = db
    .select({
      id: projects.id,
      slug: projects.slug,
      name: projects.name,
      installationId: projects.installationId,
    })
    .from(projects)
    .all();

  // installation 있는 프로젝트만 (시드 제외 — 대시보드 진척은 실 프로젝트만).
  const active = projectRows.filter((p) => p.installationId !== null);
  return active.map((p) => {
    const view = getProjectRoadmap(p.id);
    return {
      projectId: p.id,
      slug: p.slug,
      name: p.name,
      overallPct: view?.overallPct ?? 0,
      openItemCount: view?.openItems.length ?? 0,
      totalItems: view?.totalItems ?? 0,
      doneItems: view?.doneItems ?? 0,
    };
  });
}

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

// 이슈→로드맵 산출물 연결 셀렉터용 — 프로젝트의 모든 산출물을 Phase 순서대로 평탄화.
// (id + 제목 + 소속 Phase 키/제목 + 상태). Phase sortOrder → item sortOrder 순.
export type RoadmapItemOption = {
  id: number;
  title: string;
  phaseKey: string;
  phaseTitle: string;
  status: RoadmapStatus;
};

export function listRoadmapItemOptions(projectId: number): RoadmapItemOption[] {
  const phaseRows = db
    .select({
      id: roadmapPhases.id,
      key: roadmapPhases.key,
      title: roadmapPhases.title,
      sortOrder: roadmapPhases.sortOrder,
    })
    .from(roadmapPhases)
    .where(eq(roadmapPhases.projectId, projectId))
    .orderBy(asc(roadmapPhases.sortOrder), asc(roadmapPhases.id))
    .all();
  if (phaseRows.length === 0) return [];

  const phaseById = new Map(phaseRows.map((p) => [p.id, p]));
  const itemRows = db
    .select({
      id: roadmapItems.id,
      phaseId: roadmapItems.phaseId,
      title: roadmapItems.title,
      status: roadmapItems.status,
      sortOrder: roadmapItems.sortOrder,
    })
    .from(roadmapItems)
    .where(
      inArray(
        roadmapItems.phaseId,
        phaseRows.map((p) => p.id),
      ),
    )
    .all();

  const phaseSort = (phaseId: number) => phaseById.get(phaseId)?.sortOrder ?? 0;
  return itemRows
    .slice()
    .sort(
      (a, b) =>
        phaseSort(a.phaseId) - phaseSort(b.phaseId) || a.sortOrder - b.sortOrder || a.id - b.id,
    )
    .map((item) => {
      const phase = phaseById.get(item.phaseId);
      return {
        id: item.id,
        title: item.title,
        phaseKey: phase?.key ?? '',
        phaseTitle: phase?.title ?? '',
        status: item.status as RoadmapStatus,
      };
    });
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
    .select({ id: roadmapPhases.id, source: roadmapPhases.source })
    .from(roadmapPhases)
    .where(eq(roadmapPhases.id, phaseId))
    .get();
  if (!existing) return { kind: 'not-found' };
  // git source 행을 수정하면 sourceOverrideAt 마킹 — 다음 sync 가 덮어쓰지 않게.
  const updates: Record<string, unknown> = { status, updatedAt: new Date() };
  if (existing.source === 'git') {
    updates.sourceOverrideAt = new Date();
  }
  db.update(roadmapPhases).set(updates).where(eq(roadmapPhases.id, phaseId)).run();
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
    .select({ id: roadmapItems.id, source: roadmapItems.source })
    .from(roadmapItems)
    .where(eq(roadmapItems.id, itemId))
    .get();
  if (!existing) return { kind: 'not-found' };
  // 수동 toggle 이면 doneByPrId 는 null 로 (자동 done 추적 끊김).
  // git source 행을 수정하면 sourceOverrideAt 마킹 — 다음 sync 가 덮어쓰지 않게.
  const updates: Record<string, unknown> = {
    status,
    doneByPrId: null,
    updatedAt: new Date(),
  };
  if (existing.source === 'git') {
    updates.sourceOverrideAt = new Date();
  }
  db.update(roadmapItems).set(updates).where(eq(roadmapItems.id, itemId)).run();
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

  // Cascade: 'Closes #PHASE-<key>' 가 phase 단 status 뿐 아니라 그 phase 의
  // 미완료 + 미연결 item 들도 이 PR 로 자동 done + doneByPrId. 사용자 시그널
  // ("PHASE 하위 항목이 PR # 와 연결되고 누르면 PR 상세로") 실현. 명시적
  // Closes #ITEM-N 으로 이미 다른 PR 에 연결된 item 은 건드리지 않음
  // (doneByPrId IS NULL 가드).
  const matchedPhaseIds = new Set(matchedPhases.map((p) => p.id));
  const cascadedItemIds: number[] = [];
  if (matchedPhaseIds.size > 0) {
    const cascadeRows = db
      .select({ id: roadmapItems.id })
      .from(roadmapItems)
      .where(
        and(
          inArray(roadmapItems.phaseId, [...matchedPhaseIds]),
          isNull(roadmapItems.doneByPrId),
          ne(roadmapItems.status, 'done'),
        ),
      )
      .all();
    for (const row of cascadeRows) {
      // 명시적 ITEM-N 매칭으로 이미 처리된 건 제외 (id 충돌 방지 — 같은 row 두 번 갱신 X).
      if (matchedItems.some((m) => m.id === row.id)) continue;
      db.update(roadmapItems)
        .set({ status: 'done', doneByPrId: prId, updatedAt: new Date() })
        .where(eq(roadmapItems.id, row.id))
        .run();
      cascadedItemIds.push(row.id);
    }
  }

  return {
    phasesDone: matchedPhases.map((p) => p.id),
    itemsDone: [...matchedItems.map((i) => i.id), ...cascadedItemIds],
  };
}

// 이미 머지된 PR 들에 대한 일괄 매칭 backfill. 사용 시점:
// - 매칭 wire-up 전 머지된 PR 들의 로드맵 연결 채울 때 (1회 마이그레이션성)
// - `.cortex/roadmap.md` 의 phase key 가 바뀐 후 재매칭할 때
// idempotent — cascade 의 `doneByPrId IS NULL` 가드로 같은 PR 두 번 호출해도 안전.
export function reapplyRoadmapMatchesForProject(projectId: number): {
  scanned: number;
  matched: number;
} {
  const merged = db
    .select({ id: prs.id })
    .from(prs)
    .where(and(eq(prs.repoId, projectId), eq(prs.status, 'merged')))
    .all();
  let matched = 0;
  for (const pr of merged) {
    const r = matchAndApplyDoneFromPR(pr.id);
    if (r.phasesDone.length > 0 || r.itemsDone.length > 0) matched += 1;
  }
  return { scanned: merged.length, matched };
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
