import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/client';
import {
  notifications,
  prs,
  projects,
  roadmapItems,
  roadmapPhases,
  triageDecisions,
} from '@/db/schema';
import {
  createItem,
  createPhase,
  deleteItem,
  deletePhase,
  getProjectProgress,
  getProjectRoadmap,
  getPRRoadmapLinks,
  matchAndApplyDoneFromPR,
  toggleItemStatus,
  updatePhaseStatus,
} from './roadmap';

beforeAll(() => {
  migrate(db, { migrationsFolder: 'src/db/migrations' });
});

beforeEach(() => {
  db.delete(notifications).run();
  db.delete(triageDecisions).run();
  db.delete(roadmapItems).run();
  db.delete(roadmapPhases).run();
  db.delete(prs).run();
  db.delete(projects).run();
});

function seedProject(slug = 'acme/web'): number {
  return db.insert(projects).values({ slug, name: slug }).returning({ id: projects.id }).get().id;
}

function seedPR(projectId: number, body: string | null = null, number = 1): number {
  return db
    .insert(prs)
    .values({
      repoId: projectId,
      number,
      title: 'PR',
      body,
      authorKind: 'agent',
      authorId: 'claude',
      headSha: `sha-${number}`,
      linesAdded: 1,
      linesRemoved: 0,
      filesChanged: 1,
    })
    .returning({ id: prs.id })
    .get().id;
}

describe('createPhase', () => {
  it('creates with auto sortOrder', () => {
    const projectId = seedProject();
    const a = createPhase({ projectId, key: '1', title: 'A' });
    const b = createPhase({ projectId, key: '2', title: 'B' });
    expect(a.kind).toBe('created');
    expect(b.kind).toBe('created');
    const view = getProjectRoadmap(projectId)!;
    expect(view.phases.map((p) => p.key)).toEqual(['1', '2']);
  });

  it('rejects duplicate key in same project', () => {
    const projectId = seedProject();
    createPhase({ projectId, key: '1', title: 'A' });
    const dup = createPhase({ projectId, key: '1', title: 'A2' });
    expect(dup.kind).toBe('duplicate-key');
  });

  it('allows same key across projects', () => {
    const p1 = seedProject('a/x');
    const p2 = seedProject('a/y');
    expect(createPhase({ projectId: p1, key: '1', title: 'A' }).kind).toBe('created');
    expect(createPhase({ projectId: p2, key: '1', title: 'B' }).kind).toBe('created');
  });

  it('skips when project missing', () => {
    expect(createPhase({ projectId: 9999, key: '1', title: 'A' }).kind).toBe('no-project');
  });
});

describe('getProjectRoadmap progress', () => {
  it('empty roadmap → 0%', () => {
    const projectId = seedProject();
    const view = getProjectRoadmap(projectId)!;
    expect(view.phases).toEqual([]);
    expect(view.overallPct).toBe(0);
  });

  it('items 0 / phases done 비율로 fallback', () => {
    const projectId = seedProject();
    const p1 = createPhase({ projectId, key: '1', title: 'A' });
    createPhase({ projectId, key: '2', title: 'B' });
    expect(p1.kind).toBe('created');
    if (p1.kind === 'created') updatePhaseStatus(p1.id, 'done');
    const view = getProjectRoadmap(projectId)!;
    expect(view.overallPct).toBe(50);
  });

  it('items 있으면 items done 비율', () => {
    const projectId = seedProject();
    const p = createPhase({ projectId, key: '1', title: 'A' });
    if (p.kind !== 'created') throw new Error('setup');
    const i1 = createItem({ phaseId: p.id, title: 'i1' });
    const i2 = createItem({ phaseId: p.id, title: 'i2' });
    const i3 = createItem({ phaseId: p.id, title: 'i3' });
    if (i1.kind === 'created') toggleItemStatus(i1.id, 'done');
    if (i2.kind === 'created') toggleItemStatus(i2.id, 'done');
    expect(i3.kind).toBe('created');
    const view = getProjectRoadmap(projectId)!;
    expect(view.phases[0].progressPct).toBe(67);
    expect(view.overallPct).toBe(67);
  });
});

describe('getProjectProgress', () => {
  it('phaseCount / donePhaseCount', () => {
    const projectId = seedProject();
    const p1 = createPhase({ projectId, key: '1', title: 'A' });
    const p2 = createPhase({ projectId, key: '2', title: 'B' });
    if (p1.kind === 'created') updatePhaseStatus(p1.id, 'done');
    expect(p2.kind).toBe('created');
    const r = getProjectProgress(projectId);
    expect(r.phaseCount).toBe(2);
    expect(r.donePhaseCount).toBe(1);
    expect(r.overallPct).toBe(50);
  });
});

describe('matchAndApplyDoneFromPR — Closes #PHASE-<key>', () => {
  it('phase 한 개 매칭 → done', () => {
    const projectId = seedProject();
    const p = createPhase({ projectId, key: 'auth', title: 'A' });
    if (p.kind !== 'created') throw new Error('setup');
    const prId = seedPR(projectId, 'Closes #PHASE-auth');
    const r = matchAndApplyDoneFromPR(prId);
    expect(r.phasesDone).toEqual([p.id]);
    const phase = db.select().from(roadmapPhases).where(eq(roadmapPhases.id, p.id)).get();
    expect(phase?.status).toBe('done');
  });

  it('다른 프로젝트의 같은 키는 매칭 안 됨', () => {
    const p1 = seedProject('a/x');
    const p2 = seedProject('a/y');
    const phase1 = createPhase({ projectId: p1, key: 'auth', title: 'A' });
    createPhase({ projectId: p2, key: 'auth', title: 'B' });
    if (phase1.kind !== 'created') throw new Error('setup');
    // PR 이 p2 의 PR — p2 의 phase 만 매칭돼야 함.
    const prId = seedPR(p2, 'Closes #PHASE-auth');
    matchAndApplyDoneFromPR(prId);
    const phase1Row = db.select().from(roadmapPhases).where(eq(roadmapPhases.id, phase1.id)).get();
    expect(phase1Row?.status).toBe('planned'); // p1 의 phase 는 그대로
  });

  it('Closes #ITEM-N 매칭 → item done + doneByPrId', () => {
    const projectId = seedProject();
    const p = createPhase({ projectId, key: '1', title: 'A' });
    if (p.kind !== 'created') throw new Error('setup');
    const i = createItem({ phaseId: p.id, title: 'i1' });
    if (i.kind !== 'created') throw new Error('setup');
    const prId = seedPR(projectId, `Closes #ITEM-${i.id}`);
    const r = matchAndApplyDoneFromPR(prId);
    expect(r.itemsDone).toEqual([i.id]);
    const item = db.select().from(roadmapItems).where(eq(roadmapItems.id, i.id)).get();
    expect(item?.status).toBe('done');
    expect(item?.doneByPrId).toBe(prId);
  });

  it('Fixes / Resolves 키워드도 인식', () => {
    const projectId = seedProject();
    const p = createPhase({ projectId, key: 'launch', title: 'L' });
    if (p.kind !== 'created') throw new Error('setup');
    const prId = seedPR(projectId, 'Fixes #PHASE-launch and Resolves #PHASE-launch');
    matchAndApplyDoneFromPR(prId);
    const phase = db.select().from(roadmapPhases).where(eq(roadmapPhases.id, p.id)).get();
    expect(phase?.status).toBe('done');
  });

  it('PR body 빈 경우 매칭 0', () => {
    const projectId = seedProject();
    createPhase({ projectId, key: '1', title: 'A' });
    const prId = seedPR(projectId, null);
    const r = matchAndApplyDoneFromPR(prId);
    expect(r.phasesDone).toEqual([]);
    expect(r.itemsDone).toEqual([]);
  });
});

describe('getPRRoadmapLinks', () => {
  it('연결된 phase + item 반환, autoDone 플래그', () => {
    const projectId = seedProject();
    const p = createPhase({ projectId, key: 'auth', title: 'Auth' });
    if (p.kind !== 'created') throw new Error('setup');
    const i = createItem({ phaseId: p.id, title: 'item-1' });
    if (i.kind !== 'created') throw new Error('setup');
    const prId = seedPR(projectId, `Closes #PHASE-auth and Closes #ITEM-${i.id}`);
    matchAndApplyDoneFromPR(prId);
    const links = getPRRoadmapLinks(prId);
    expect(links).toHaveLength(2);
    const phaseLink = links.find((l) => l.kind === 'phase')!;
    expect(phaseLink.phaseKey).toBe('auth');
    const itemLink = links.find((l) => l.kind === 'item')!;
    expect(itemLink.autoDone).toBe(true);
  });
});

describe('deletePhase / deleteItem', () => {
  it('phase 삭제 시 items 도 같이 삭제', () => {
    const projectId = seedProject();
    const p = createPhase({ projectId, key: '1', title: 'A' });
    if (p.kind !== 'created') throw new Error('setup');
    createItem({ phaseId: p.id, title: 'i1' });
    createItem({ phaseId: p.id, title: 'i2' });
    deletePhase(p.id);
    const phases = db.select().from(roadmapPhases).all();
    const items = db.select().from(roadmapItems).all();
    expect(phases).toHaveLength(0);
    expect(items).toHaveLength(0);
  });

  it('deleteItem 은 phase 유지', () => {
    const projectId = seedProject();
    const p = createPhase({ projectId, key: '1', title: 'A' });
    if (p.kind !== 'created') throw new Error('setup');
    const i = createItem({ phaseId: p.id, title: 'i1' });
    if (i.kind !== 'created') throw new Error('setup');
    deleteItem(i.id);
    const phases = db.select().from(roadmapPhases).all();
    const items = db.select().from(roadmapItems).all();
    expect(phases).toHaveLength(1);
    expect(items).toHaveLength(0);
  });
});
