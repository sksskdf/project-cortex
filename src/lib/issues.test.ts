import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/client';
import { agentRuns, issues, projects, prs, roadmapItems, roadmapPhases } from '@/db/schema';
import {
  completeIssueDelegation,
  countOpenIssues,
  finishAgentRun,
  getIssueDetail,
  linkIssueToRoadmapItem,
  listIssues,
  startAgentRun,
} from './issues';

beforeAll(() => {
  migrate(db, { migrationsFolder: 'src/db/migrations' });
});

beforeEach(() => {
  // FK 순서대로 정리 — agent_runs → prs → issues → roadmap_items → roadmap_phases → projects.
  // issues 가 roadmap_items 를 참조하므로 roadmap_items 보다 먼저 지운다.
  db.delete(agentRuns).run();
  db.delete(prs).run();
  db.delete(issues).run();
  db.delete(roadmapItems).run();
  db.delete(roadmapPhases).run();
  db.delete(projects).run();
});

function seedRoadmapItem(projectId: number, title: string): number {
  const phaseId = db
    .insert(roadmapPhases)
    .values({ projectId, key: 'p1', title: 'phase 1' })
    .returning({ id: roadmapPhases.id })
    .get().id;
  return db.insert(roadmapItems).values({ phaseId, title }).returning({ id: roadmapItems.id }).get()
    .id;
}

function seedProject(slug: string): number {
  return db.insert(projects).values({ slug, name: slug }).returning({ id: projects.id }).get().id;
}

function seedIssue(repoId: number, title: string, status: 'open' | 'in-progress' = 'open'): number {
  return db
    .insert(issues)
    .values({ repoId, title, spec: 'spec', assigneeKind: 'human', assigneeId: 'me', status })
    .returning({ id: issues.id })
    .get().id;
}

describe('listIssues', () => {
  it('maps status + project slug', () => {
    const repoId = seedProject('cortex-web');
    seedIssue(repoId, 'first issue', 'in-progress');
    const list = listIssues();
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe('first issue');
    expect(list[0].status).toBe('in-progress');
    expect(list[0].projectSlug).toBe('cortex-web');
    expect(list[0].sessionStatus).toBeNull();
    expect(list[0].resultPrId).toBeNull();
  });

  it('joins latest agent run session status + result PR', () => {
    const repoId = seedProject('api');
    const issueId = seedIssue(repoId, 'delegated', 'in-progress');
    const prId = db
      .insert(prs)
      .values({
        repoId,
        number: 42,
        title: 'fix',
        authorKind: 'agent',
        authorId: 'claude-code',
        headSha: 'abc',
        linesAdded: 1,
        linesRemoved: 0,
        filesChanged: 1,
      })
      .returning({ id: prs.id })
      .get().id;
    // 더 오래된 run 먼저, 최신 completed run 이 결과 PR 을 가짐.
    db.insert(agentRuns)
      .values({ issueId, agent: 'claude', status: 'failed', startedAt: new Date('2026-01-01') })
      .run();
    db.insert(agentRuns)
      .values({
        issueId,
        agent: 'claude',
        status: 'completed',
        outputPrId: prId,
        startedAt: new Date('2026-02-01'),
      })
      .run();

    const list = listIssues();
    expect(list).toHaveLength(1);
    expect(list[0].sessionStatus).toBe('completed');
    expect(list[0].resultPrId).toBe(prId);
    expect(list[0].resultPrNumber).toBe(42);
  });

  it('orders newest first', () => {
    const repoId = seedProject('repo');
    seedIssue(repoId, 'older');
    seedIssue(repoId, 'newer');
    const list = listIssues();
    expect(list.map((i) => i.title)).toEqual(['newer', 'older']);
  });

  it('returns empty list with no issues', () => {
    expect(listIssues()).toEqual([]);
  });
});

describe('countOpenIssues', () => {
  it('counts open + in-progress only', () => {
    const repoId = seedProject('repo');
    seedIssue(repoId, 'a', 'open');
    seedIssue(repoId, 'b', 'in-progress');
    const doneId = seedIssue(repoId, 'c', 'open');
    db.update(issues).set({ status: 'done' }).where(eq(issues.id, doneId)).run();
    expect(countOpenIssues()).toBe(2);
  });
});

describe('startAgentRun / finishAgentRun', () => {
  it('startAgentRun 은 running run 을 만들고 상세에 노출된다', () => {
    const repoId = seedProject('repo');
    const issueId = seedIssue(repoId, 'delegated', 'in-progress');

    const runId = startAgentRun(issueId);
    expect(runId).toBeGreaterThan(0);

    const run = db.select().from(agentRuns).where(eq(agentRuns.id, runId)).get();
    expect(run?.status).toBe('running');
    expect(run?.startedAt).not.toBeNull();
    expect(run?.completedAt).toBeNull();

    expect(getIssueDetail(issueId)!.runs[0].status).toBe('running');
  });

  it('finishAgentRun(ok=true) → completed + completedAt', () => {
    const repoId = seedProject('repo');
    const runId = startAgentRun(seedIssue(repoId, 'x', 'in-progress'));
    finishAgentRun(runId, true);
    const run = db.select().from(agentRuns).where(eq(agentRuns.id, runId)).get();
    expect(run?.status).toBe('completed');
    expect(run?.completedAt).not.toBeNull();
  });

  it('finishAgentRun(ok=false) → failed', () => {
    const repoId = seedProject('repo');
    const runId = startAgentRun(seedIssue(repoId, 'x', 'in-progress'));
    finishAgentRun(runId, false);
    expect(db.select().from(agentRuns).where(eq(agentRuns.id, runId)).get()?.status).toBe('failed');
  });
});

describe('completeIssueDelegation', () => {
  it('마감: running/queued run → completed, 이슈 → done', () => {
    const repoId = seedProject('repo');
    const issueId = seedIssue(repoId, 'stuck', 'in-progress');
    const runId = startAgentRun(issueId); // running
    db.insert(agentRuns)
      .values({ issueId, agent: 'claude', status: 'queued', startedAt: new Date() })
      .run();

    const r = completeIssueDelegation(issueId);
    expect(r.kind).toBe('completed');
    if (r.kind === 'completed') expect(r.completedRuns).toBe(2);

    expect(db.select().from(agentRuns).where(eq(agentRuns.id, runId)).get()?.status).toBe(
      'completed',
    );
    expect(db.select().from(issues).where(eq(issues.id, issueId)).get()?.status).toBe('done');
  });

  it('완료된 run 은 건드리지 않고 이슈만 done (멱등)', () => {
    const repoId = seedProject('repo');
    const issueId = seedIssue(repoId, 'no-running', 'in-progress');
    const runId = startAgentRun(issueId);
    finishAgentRun(runId, true);

    const r = completeIssueDelegation(issueId);
    expect(r.kind).toBe('completed');
    if (r.kind === 'completed') expect(r.completedRuns).toBe(0);
    expect(db.select().from(issues).where(eq(issues.id, issueId)).get()?.status).toBe('done');
  });

  it('없는 이슈 → not-found', () => {
    expect(completeIssueDelegation(9999).kind).toBe('not-found');
  });
});

describe('getIssueDetail', () => {
  it('returns null for a missing issue', () => {
    expect(getIssueDetail(999)).toBeNull();
  });

  it('maps fields, project, spec and empty runs', () => {
    const repoId = seedProject('cortex-web');
    const issueId = db
      .insert(issues)
      .values({
        repoId,
        title: 'detail issue',
        spec: 'do the thing',
        assigneeKind: 'human',
        assigneeId: 'me',
        status: 'open',
      })
      .returning({ id: issues.id })
      .get().id;

    const detail = getIssueDetail(issueId);
    expect(detail).not.toBeNull();
    expect(detail!.title).toBe('detail issue');
    expect(detail!.spec).toBe('do the thing');
    expect(detail!.projectSlug).toBe('cortex-web');
    expect(detail!.assigneeKind).toBe('human');
    expect(detail!.runs).toEqual([]);
  });

  it('roadmap 링크 기본값은 null', () => {
    const repoId = seedProject('repo');
    const issueId = seedIssue(repoId, 'no link');
    const detail = getIssueDetail(issueId)!;
    expect(detail.roadmapItemId).toBeNull();
    expect(detail.roadmapItemTitle).toBeNull();
  });

  it('linkIssueToRoadmapItem 후 상세에 id + title 노출', () => {
    const repoId = seedProject('repo');
    const issueId = seedIssue(repoId, 'linked');
    const itemId = seedRoadmapItem(repoId, '산출물 A');

    linkIssueToRoadmapItem(issueId, itemId);
    const detail = getIssueDetail(issueId)!;
    expect(detail.roadmapItemId).toBe(itemId);
    expect(detail.roadmapItemTitle).toBe('산출물 A');

    // null 로 연결 해제.
    linkIssueToRoadmapItem(issueId, null);
    const cleared = getIssueDetail(issueId)!;
    expect(cleared.roadmapItemId).toBeNull();
    expect(cleared.roadmapItemTitle).toBeNull();
  });

  it('includes agent runs newest-first with result PR number', () => {
    const repoId = seedProject('api');
    const issueId = seedIssue(repoId, 'delegated', 'in-progress');
    const prId = db
      .insert(prs)
      .values({
        repoId,
        number: 7,
        title: 'fix',
        authorKind: 'agent',
        authorId: 'claude-code',
        headSha: 'abc',
        linesAdded: 1,
        linesRemoved: 0,
        filesChanged: 1,
      })
      .returning({ id: prs.id })
      .get().id;
    db.insert(agentRuns)
      .values({ issueId, agent: 'claude', status: 'failed', startedAt: new Date('2026-01-01') })
      .run();
    db.insert(agentRuns)
      .values({
        issueId,
        agent: 'claude',
        status: 'completed',
        outputPrId: prId,
        startedAt: new Date('2026-02-01'),
      })
      .run();

    const detail = getIssueDetail(issueId);
    expect(detail!.runs).toHaveLength(2);
    expect(detail!.runs[0].status).toBe('completed');
    expect(detail!.runs[0].resultPrNumber).toBe(7);
    expect(detail!.runs[1].status).toBe('failed');
    expect(detail!.runs[1].resultPrNumber).toBeNull();
  });
});
