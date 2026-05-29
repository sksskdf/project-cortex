import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/client';
import { agentRuns, issues, prs, projects, roadmapItems, roadmapPhases, todos } from '@/db/schema';
import { getWorkView } from './work-view';

beforeAll(() => {
  migrate(db, { migrationsFolder: 'src/db/migrations' });
});

beforeEach(() => {
  db.delete(todos).run();
  db.delete(agentRuns).run();
  db.delete(issues).run();
  db.delete(roadmapItems).run();
  db.delete(roadmapPhases).run();
  db.delete(prs).run();
  db.delete(projects).run();
});

function project(slug = 'a/b'): number {
  return db.insert(projects).values({ slug, name: slug }).returning({ id: projects.id }).get().id;
}

function roadmapItem(projectId: number, title: string): number {
  const phase = db
    .insert(roadmapPhases)
    .values({ projectId, key: `P${title}`, title: 'Phase' })
    .returning({ id: roadmapPhases.id })
    .get();
  return db
    .insert(roadmapItems)
    .values({ phaseId: phase.id, title })
    .returning({ id: roadmapItems.id })
    .get().id;
}

function issue(
  repoId: number,
  title: string,
  status: 'open' | 'in-progress' | 'done',
  roadmapItemId: number | null,
): number {
  return db
    .insert(issues)
    .values({
      repoId,
      title,
      spec: 's',
      assigneeKind: 'agent',
      assigneeId: 'x',
      status,
      roadmapItemId,
    })
    .returning({ id: issues.id })
    .get().id;
}

describe('getWorkView', () => {
  it('빈 상태는 빈 배열', () => {
    expect(getWorkView()).toEqual([]);
  });

  it('done/closed 이슈는 제외하고 활성 이슈만', () => {
    const p = project();
    issue(p, 'active', 'open', null);
    issue(p, 'finished', 'done', null);
    const view = getWorkView();
    expect(view).toHaveLength(1);
    const allIssues = view[0].groups.flatMap((g) => g.issues);
    expect(allIssues.map((i) => i.title)).toEqual(['active']);
  });

  it('로드맵 산출물별로 이슈를 묶고, 미연결은 마지막 그룹(null)', () => {
    const p = project();
    const itemId = roadmapItem(p, '산출물 A');
    issue(p, 'linked', 'in-progress', itemId);
    issue(p, 'unlinked', 'open', null);

    const view = getWorkView();
    expect(view).toHaveLength(1);
    const groups = view[0].groups;
    // 로드맵 항목 그룹 먼저, 미연결(null) 마지막.
    expect(groups[0].roadmapItemId).toBe(itemId);
    expect(groups[0].roadmapItemTitle).toBe('산출물 A');
    expect(groups[0].issues.map((i) => i.title)).toEqual(['linked']);
    expect(groups[groups.length - 1].roadmapItemId).toBeNull();
    expect(groups[groups.length - 1].issues.map((i) => i.title)).toEqual(['unlinked']);
  });

  it('이슈에 미완 TODO + 결과 PR(최신 run) 부착', () => {
    const p = project();
    const prRow = db
      .insert(prs)
      .values({
        repoId: p,
        number: 42,
        title: 'PR',
        authorKind: 'agent',
        authorId: 'x',
        headSha: 's',
        linesAdded: 1,
        linesRemoved: 0,
        filesChanged: 1,
        status: 'merged',
      })
      .returning({ id: prs.id })
      .get();
    const iid = issue(p, 'work', 'in-progress', null);
    db.insert(agentRuns)
      .values({ issueId: iid, agent: 'claude', status: 'running', outputPrId: prRow.id })
      .run();
    db.insert(todos).values({ title: 'open todo', issueId: iid, status: 'open' }).run();
    db.insert(todos).values({ title: 'done todo', issueId: iid, status: 'done' }).run();

    const wi = getWorkView()[0].groups[0].issues[0];
    expect(wi.sessionStatus).toBe('running');
    expect(wi.resultPrId).toBe(prRow.id);
    expect(wi.resultPrNumber).toBe(42);
    // 미완 TODO 만.
    expect(wi.todos.map((t) => t.title)).toEqual(['open todo']);
  });
});
