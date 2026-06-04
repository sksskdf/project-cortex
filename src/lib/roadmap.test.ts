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
  listRoadmapItemOptions,
  matchAndApplyDoneFromPR,
  reapplyRoadmapMatchesForProject,
  toggleItemStatus,
  updateItemTitle,
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

describe('updateItemTitle', () => {
  it('제목을 갱신한다', () => {
    const pid = seedProject();
    const phase = createPhase({ projectId: pid, key: '1', title: 'P', goal: null });
    if (phase.kind !== 'created') throw new Error('phase');
    const item = createItem({ phaseId: phase.id, title: '옛 제목' });
    if (item.kind !== 'created') throw new Error('item');

    expect(updateItemTitle(item.id, '새 제목').kind).toBe('updated');
    expect(db.select().from(roadmapItems).where(eq(roadmapItems.id, item.id)).get()?.title).toBe(
      '새 제목',
    );
  });

  it('빈 제목은 invalid', () => {
    const pid = seedProject();
    const phase = createPhase({ projectId: pid, key: '1', title: 'P', goal: null });
    if (phase.kind !== 'created') throw new Error('phase');
    const item = createItem({ phaseId: phase.id, title: 'x' });
    if (item.kind !== 'created') throw new Error('item');
    expect(updateItemTitle(item.id, '   ').kind).toBe('invalid');
  });

  it('없는 항목은 not-found', () => {
    expect(updateItemTitle(99999, 'y').kind).toBe('not-found');
  });

  it('git source 항목 편집 시 sourceOverrideAt 마킹', () => {
    const pid = seedProject();
    const phase = createPhase({ projectId: pid, key: '1', title: 'P', goal: null });
    if (phase.kind !== 'created') throw new Error('phase');
    const id = db
      .insert(roadmapItems)
      .values({ phaseId: phase.id, title: 'git항목', sortOrder: 0, source: 'git' })
      .returning({ id: roadmapItems.id })
      .get().id;
    updateItemTitle(id, '편집됨');
    expect(
      db.select().from(roadmapItems).where(eq(roadmapItems.id, id)).get()?.sourceOverrideAt,
    ).not.toBeNull();
  });
});

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

describe('listRoadmapItemOptions', () => {
  it('flattens items in phase→item sort order with phase key/title', () => {
    const projectId = seedProject();
    createPhase({ projectId, key: '1', title: 'Phase One' });
    createPhase({ projectId, key: '2', title: 'Phase Two' });
    const view = getProjectRoadmap(projectId)!;
    const phase1 = view.phases.find((p) => p.key === '1')!;
    const phase2 = view.phases.find((p) => p.key === '2')!;
    createItem({ phaseId: phase2.id, title: 'item-2a' });
    createItem({ phaseId: phase1.id, title: 'item-1a' });
    createItem({ phaseId: phase1.id, title: 'item-1b' });

    const opts = listRoadmapItemOptions(projectId);
    // Phase sortOrder(1→2) → item sortOrder 순.
    expect(opts.map((o) => o.title)).toEqual(['item-1a', 'item-1b', 'item-2a']);
    expect(opts[0].phaseKey).toBe('1');
    expect(opts[0].phaseTitle).toBe('Phase One');
    expect(opts[2].phaseKey).toBe('2');
  });

  it('returns empty when no phases', () => {
    const projectId = seedProject();
    expect(listRoadmapItemOptions(projectId)).toEqual([]);
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

  it('Closes #PHASE-<key> cascade → phase 의 미완료 item 들도 doneByPrId', () => {
    const projectId = seedProject();
    const p = createPhase({ projectId, key: '11', title: 'Phase 11' });
    if (p.kind !== 'created') throw new Error('setup');
    const i1 = createItem({ phaseId: p.id, title: 'todos 테이블' });
    const i2 = createItem({ phaseId: p.id, title: '/todos 페이지' });
    if (i1.kind !== 'created' || i2.kind !== 'created') throw new Error('setup');
    const prId = seedPR(projectId, 'Closes #PHASE-11');
    const r = matchAndApplyDoneFromPR(prId);
    expect(r.phasesDone).toEqual([p.id]);
    expect(r.itemsDone).toEqual(expect.arrayContaining([i1.id, i2.id]));
    const item1 = db.select().from(roadmapItems).where(eq(roadmapItems.id, i1.id)).get();
    expect(item1?.doneByPrId).toBe(prId);
    expect(item1?.status).toBe('done');
  });

  it('cascade 가 이미 다른 PR 로 done 된 item 은 건드리지 않음', () => {
    const projectId = seedProject();
    const p = createPhase({ projectId, key: '12', title: 'Phase 12' });
    if (p.kind !== 'created') throw new Error('setup');
    const i1 = createItem({ phaseId: p.id, title: 'workspaces 테이블' });
    if (i1.kind !== 'created') throw new Error('setup');
    // 첫 PR 이 #ITEM-N 으로 명시 매칭.
    const prFirst = seedPR(projectId, `Closes #ITEM-${i1.id}`);
    matchAndApplyDoneFromPR(prFirst);
    // 두 번째 PR 이 같은 phase 를 cascade 매칭 — 기존 doneByPrId 덮어쓰면 안 됨.
    const prSecond = seedPR(projectId, 'Closes #PHASE-12');
    const r = matchAndApplyDoneFromPR(prSecond);
    expect(r.itemsDone).not.toContain(i1.id);
    const item1 = db.select().from(roadmapItems).where(eq(roadmapItems.id, i1.id)).get();
    expect(item1?.doneByPrId).toBe(prFirst); // 첫 PR 유지
  });

  // 점 구분 키 매칭 — `13.6` 이 부모 `13` 으로 잘리지 않아야 데이터 오염 0.
  it('점 구분 키(#PHASE-13.6) 가 자식만 매칭, 부모(13) 는 안 건드림', () => {
    const projectId = seedProject();
    const parent = createPhase({ projectId, key: '13', title: 'Parent' });
    const child = createPhase({ projectId, key: '13.6', title: 'Child' });
    if (parent.kind !== 'created' || child.kind !== 'created') throw new Error('setup');
    const prId = seedPR(projectId, 'Closes #PHASE-13.6');
    const r = matchAndApplyDoneFromPR(prId);
    expect(r.phasesDone).toEqual([child.id]);
    const parentRow = db.select().from(roadmapPhases).where(eq(roadmapPhases.id, parent.id)).get();
    expect(parentRow?.status).toBe('planned');
  });

  // 끝 문장부호(`.`) 가 키에 포함 안 됨 (`#PHASE-13.6.` → 키는 `13.6`).
  it('끝 문장부호 . 는 키 미포함', () => {
    const projectId = seedProject();
    const child = createPhase({ projectId, key: '13.6', title: 'Child' });
    if (child.kind !== 'created') throw new Error('setup');
    const prId = seedPR(projectId, 'Closes #PHASE-13.6.');
    const r = matchAndApplyDoneFromPR(prId);
    expect(r.phasesDone).toEqual([child.id]);
  });

  // 회귀(리뷰 발견): 단어 경계 없어 산문 단어 속 부분 문자열이 매칭 → 무관 phase done.
  it('산문 단어 속 부분 문자열은 매칭 안 됨 (discloses/encloses/unresolves)', () => {
    const projectId = seedProject();
    const p = createPhase({ projectId, key: '3', title: 'P3' });
    if (p.kind !== 'created') throw new Error('setup');
    const body = [
      'This PR discloses #PHASE-3 internals for review.',
      'It also encloses #PHASE-3 and unresolves #PHASE-3 nothing.',
    ].join('\n');
    const r = matchAndApplyDoneFromPR(seedPR(projectId, body));
    expect(r.phasesDone).toEqual([]);
    const phase = db.select().from(roadmapPhases).where(eq(roadmapPhases.id, p.id)).get();
    expect(phase?.status).toBe('planned');
  });

  // 회귀: 시제 변형(Closed/Fix/Fixed/Resolve/Resolved) 모두 인식 (GitHub 컨벤션).
  it('단/복수·과거형 키워드 모두 인식', () => {
    const projectId = seedProject();
    for (const [key, kw] of [
      ['a', 'Close'],
      ['b', 'Closed'],
      ['c', 'Fix'],
      ['d', 'Fixed'],
      ['e', 'Resolve'],
      ['f', 'Resolved'],
    ] as const) {
      const p = createPhase({ projectId, key, title: key });
      if (p.kind !== 'created') throw new Error('setup');
      matchAndApplyDoneFromPR(
        seedPR(projectId, `${kw} #PHASE-${key}`, Math.floor(Math.random() * 1e6)),
      );
      const phase = db.select().from(roadmapPhases).where(eq(roadmapPhases.id, p.id)).get();
      expect(phase?.status, `${kw} 인식`).toBe('done');
    }
  });

  // 회귀: 펜스 코드/blockquote/HTML주석 안의 Closes 는 예시·인용이라 발화 안 됨.
  it('펜스 코드블록·blockquote·HTML주석 안의 Closes 는 매칭 안 됨', () => {
    const projectId = seedProject();
    const p = createPhase({ projectId, key: '3', title: 'P3' });
    if (p.kind !== 'created') throw new Error('setup');
    const body = [
      '컨벤션 예시:',
      '```',
      'Closes #PHASE-3',
      '```',
      '> 인용: Fixes #PHASE-3',
      '<!-- Resolves #PHASE-3 -->',
    ].join('\n');
    const r = matchAndApplyDoneFromPR(seedPR(projectId, body));
    expect(r.phasesDone).toEqual([]);
  });

  it('펜스 밖 실제 Closes 는 정상 매칭 (펜스 안 예시와 공존)', () => {
    const projectId = seedProject();
    const p = createPhase({ projectId, key: '3', title: 'P3' });
    if (p.kind !== 'created') throw new Error('setup');
    const body = ['```\nCloses #PHASE-3\n```', '', '실제로 Closes #PHASE-3 완료.'].join('\n');
    const r = matchAndApplyDoneFromPR(seedPR(projectId, body));
    expect(r.phasesDone).toEqual([p.id]);
  });

  // 회귀: 사용자가 override 한 phase/item 은 PR Closes 가 force-done 하지 않음.
  it('sourceOverrideAt 마킹된 phase 는 Closes 로 done 안 됨', () => {
    const projectId = seedProject();
    const p = createPhase({ projectId, key: '3', title: 'P3' });
    if (p.kind !== 'created') throw new Error('setup');
    db.update(roadmapPhases)
      .set({ sourceOverrideAt: new Date(), status: 'planned' })
      .where(eq(roadmapPhases.id, p.id))
      .run();
    const r = matchAndApplyDoneFromPR(seedPR(projectId, 'Closes #PHASE-3'));
    expect(r.phasesDone).toEqual([]);
    expect(db.select().from(roadmapPhases).where(eq(roadmapPhases.id, p.id)).get()?.status).toBe(
      'planned',
    );
  });

  it('sourceOverrideAt 마킹된 item 은 cascade·명시 Closes 둘 다에서 제외', () => {
    const projectId = seedProject();
    const p = createPhase({ projectId, key: '3', title: 'P3' });
    if (p.kind !== 'created') throw new Error('setup');
    const overridden = createItem({ phaseId: p.id, title: 'override 항목' });
    const normal = createItem({ phaseId: p.id, title: '일반 항목' });
    if (overridden.kind !== 'created' || normal.kind !== 'created') throw new Error('setup');
    db.update(roadmapItems)
      .set({ sourceOverrideAt: new Date() })
      .where(eq(roadmapItems.id, overridden.id))
      .run();
    // 명시 #ITEM-N + phase cascade 둘 다 시도.
    const r = matchAndApplyDoneFromPR(
      seedPR(projectId, `Closes #PHASE-3 and Closes #ITEM-${overridden.id}`),
    );
    expect(r.itemsDone).not.toContain(overridden.id); // override 제외
    expect(r.itemsDone).toContain(normal.id); // 일반은 cascade
    expect(
      db.select().from(roadmapItems).where(eq(roadmapItems.id, overridden.id)).get()?.status,
    ).not.toBe('done');
  });

  // 회귀: 명시 #ITEM-N 재적용이 다른 PR 의 doneByPrId 를 덮어쓰지 않음 (멱등).
  it('명시 #ITEM-N 도 첫 PR attribution 보존 (두 번째 PR 이 덮어쓰지 않음)', () => {
    const projectId = seedProject();
    const p = createPhase({ projectId, key: '1', title: 'A' });
    if (p.kind !== 'created') throw new Error('setup');
    const item = createItem({ phaseId: p.id, title: 'i1' });
    if (item.kind !== 'created') throw new Error('setup');
    const prFirst = seedPR(projectId, `Closes #ITEM-${item.id}`, 1);
    matchAndApplyDoneFromPR(prFirst);
    const prSecond = seedPR(projectId, `Closes #ITEM-${item.id}`, 2);
    const r = matchAndApplyDoneFromPR(prSecond);
    expect(r.itemsDone).not.toContain(item.id); // 이미 done 이라 제외
    expect(
      db.select().from(roadmapItems).where(eq(roadmapItems.id, item.id)).get()?.doneByPrId,
    ).toBe(prFirst); // 첫 PR 유지
  });
});

describe('reapplyRoadmapMatchesForProject — backfill', () => {
  it('머지된 PR 들 일괄 매칭, open PR 은 무시', () => {
    const projectId = seedProject();
    const p = createPhase({ projectId, key: '11', title: 'P11' });
    if (p.kind !== 'created') throw new Error('setup');
    const i = createItem({ phaseId: p.id, title: 'i1' });
    if (i.kind !== 'created') throw new Error('setup');
    // merged PR — body 마커 있음.
    const mergedPrId = seedPR(projectId, 'Closes #PHASE-11');
    db.update(prs).set({ status: 'merged' }).where(eq(prs.id, mergedPrId)).run();
    // open PR — body 마커 있어도 backfill 안 잡힘.
    const openPrId = seedPR(projectId, 'Closes #PHASE-11');
    db.update(prs).set({ status: 'open' }).where(eq(prs.id, openPrId)).run();

    const r = reapplyRoadmapMatchesForProject(projectId);
    expect(r.scanned).toBe(1); // merged 만
    expect(r.matched).toBe(1);
    const item = db.select().from(roadmapItems).where(eq(roadmapItems.id, i.id)).get();
    expect(item?.doneByPrId).toBe(mergedPrId);
  });

  it('idempotent — 두 번 호출해도 doneByPrId 안 덮어쓰기', () => {
    const projectId = seedProject();
    const p = createPhase({ projectId, key: '12', title: 'P12' });
    if (p.kind !== 'created') throw new Error('setup');
    const i = createItem({ phaseId: p.id, title: 'i1' });
    if (i.kind !== 'created') throw new Error('setup');
    const firstPrId = seedPR(projectId, 'Closes #PHASE-12');
    db.update(prs).set({ status: 'merged' }).where(eq(prs.id, firstPrId)).run();
    reapplyRoadmapMatchesForProject(projectId);
    // 더 뒤에 머지된 같은 phase PR — 이미 first 로 채워졌으니 안 덮어씀.
    const secondPrId = seedPR(projectId, 'Closes #PHASE-12');
    db.update(prs).set({ status: 'merged' }).where(eq(prs.id, secondPrId)).run();
    reapplyRoadmapMatchesForProject(projectId);
    const item = db.select().from(roadmapItems).where(eq(roadmapItems.id, i.id)).get();
    expect(item?.doneByPrId).toBe(firstPrId);
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
