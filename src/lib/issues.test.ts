import { and, eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/client';
import { agentRuns, issues, projects, prs, roadmapItems, roadmapPhases } from '@/db/schema';
import {
  completeIssueDelegation,
  countOpenIssues,
  extractCortexIssueRef,
  finishAgentRun,
  getIssueContextForPR,
  getIssueDetail,
  linkIssueToRoadmapItem,
  linkOutputPrFromBody,
  listIssueOptions,
  listIssues,
  reconcileOrphanedRuns,
  reconcileStaleRuns,
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

  // 회귀(리뷰 발견): double-invoke 로 같은 이슈에 'running' 이 중복 누적되던 것 — 새 위임이
  // 기존 active run 을 superseded(failed)로 마감해 한 이슈 = 한 active 위임 유지.
  it('startAgentRun 재호출 시 같은 이슈의 이전 active run 을 superseded(failed) 처리', () => {
    const repoId = seedProject('repo');
    const issueId = seedIssue(repoId, 'double', 'in-progress');

    const first = startAgentRun(issueId);
    const second = startAgentRun(issueId);
    expect(second).not.toBe(first);

    // 이전 run 은 failed 로 마감, 새 run 만 running.
    expect(db.select().from(agentRuns).where(eq(agentRuns.id, first)).get()?.status).toBe('failed');
    expect(db.select().from(agentRuns).where(eq(agentRuns.id, second)).get()?.status).toBe(
      'running',
    );
    // 이슈의 active running run 은 정확히 1개.
    const activeRunning = db
      .select()
      .from(agentRuns)
      .where(and(eq(agentRuns.issueId, issueId), eq(agentRuns.status, 'running')))
      .all();
    expect(activeRunning).toHaveLength(1);
  });

  it('다른 이슈의 active run 은 startAgentRun 에 영향받지 않음', () => {
    const repoId = seedProject('repo');
    const issueA = seedIssue(repoId, 'a', 'in-progress');
    const issueB = seedIssue(repoId, 'b', 'in-progress');
    const runA = startAgentRun(issueA);
    startAgentRun(issueB); // 다른 이슈 — runA 에 영향 없어야
    expect(db.select().from(agentRuns).where(eq(agentRuns.id, runA)).get()?.status).toBe('running');
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

describe('reconcileOrphanedRuns', () => {
  it('복원 불가한 running/queued run 을 failed 로 마감', () => {
    const repoId = seedProject('repo');
    const orphan = startAgentRun(seedIssue(repoId, 'a', 'in-progress'));
    const restorable = startAgentRun(seedIssue(repoId, 'b', 'in-progress'));

    const r = reconcileOrphanedRuns([restorable]);
    expect(r.failed).toBe(1);
    expect(db.select().from(agentRuns).where(eq(agentRuns.id, orphan)).get()?.status).toBe(
      'failed',
    );
    // 복원 가능 세션의 run 은 그대로 running.
    expect(db.select().from(agentRuns).where(eq(agentRuns.id, restorable)).get()?.status).toBe(
      'running',
    );
  });

  it('복원 목록이 비면 모든 running/queued 를 failed', () => {
    const repoId = seedProject('repo');
    const a = startAgentRun(seedIssue(repoId, 'a', 'in-progress'));
    const b = startAgentRun(seedIssue(repoId, 'b', 'in-progress'));
    const r = reconcileOrphanedRuns([]);
    expect(r.failed).toBe(2);
    expect(db.select().from(agentRuns).where(eq(agentRuns.id, a)).get()?.status).toBe('failed');
    expect(db.select().from(agentRuns).where(eq(agentRuns.id, b)).get()?.status).toBe('failed');
  });

  it('이미 completed/failed 인 run 은 건드리지 않음', () => {
    const repoId = seedProject('repo');
    const done = startAgentRun(seedIssue(repoId, 'a', 'in-progress'));
    finishAgentRun(done, true);
    const r = reconcileOrphanedRuns([]);
    expect(r.failed).toBe(0);
    expect(db.select().from(agentRuns).where(eq(agentRuns.id, done)).get()?.status).toBe(
      'completed',
    );
  });
});

describe('reconcileStaleRuns', () => {
  // 오래된 startedAt 의 running run 을 직접 삽입.
  function staleRun(repoId: number, title: string, startedAt: Date | null): number {
    const issueId = seedIssue(repoId, title, 'in-progress');
    return db
      .insert(agentRuns)
      .values({ issueId, agent: 'claude', status: 'running', startedAt })
      .returning({ id: agentRuns.id })
      .get().id;
  }

  it('임계값보다 오래된 running 은 failed, 최근 것은 유지', () => {
    const repoId = seedProject('repo');
    const old = staleRun(repoId, 'old', new Date(Date.now() - 25 * 60 * 60 * 1000)); // 25h 전
    const fresh = staleRun(repoId, 'fresh', new Date(Date.now() - 1 * 60 * 60 * 1000)); // 1h 전

    const r = reconcileStaleRuns(24 * 60 * 60 * 1000);
    expect(r.failed).toBe(1);
    expect(db.select().from(agentRuns).where(eq(agentRuns.id, old)).get()?.status).toBe('failed');
    expect(db.select().from(agentRuns).where(eq(agentRuns.id, fresh)).get()?.status).toBe(
      'running',
    );
  });

  it('startedAt 이 null 이면 제외(아직 시작 안 함)', () => {
    const repoId = seedProject('repo');
    const queued = staleRun(repoId, 'q', null);
    const r = reconcileStaleRuns(24 * 60 * 60 * 1000);
    expect(r.failed).toBe(0);
    expect(db.select().from(agentRuns).where(eq(agentRuns.id, queued)).get()?.status).toBe(
      'running',
    );
  });

  it('completed run 은 오래됐어도 무변경', () => {
    const repoId = seedProject('repo');
    const old = staleRun(repoId, 'old', new Date(Date.now() - 100 * 60 * 60 * 1000));
    finishAgentRun(old, true);
    const r = reconcileStaleRuns(24 * 60 * 60 * 1000);
    expect(r.failed).toBe(0);
    expect(db.select().from(agentRuns).where(eq(agentRuns.id, old)).get()?.status).toBe(
      'completed',
    );
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

  // 회귀(리뷰 발견): 예전엔 status 무관 무조건 'done' 으로 덮어써, 사용자가 닫은(closed) 이슈에
  // 이 액션이 다시 닿으면 'closed' → 'done' 으로 회귀했다. 이제 closed/done 은 안 건드림.
  it('closed 이슈는 done 으로 회귀시키지 않음 (status 가드)', () => {
    const repoId = seedProject('repo');
    const issueId = seedIssue(repoId, 'closed one', 'in-progress');
    db.update(issues).set({ status: 'closed' }).where(eq(issues.id, issueId)).run();
    const runId = startAgentRun(issueId); // 잔류 running run

    const r = completeIssueDelegation(issueId);
    expect(r.kind).toBe('completed');
    if (r.kind === 'completed') expect(r.completedRuns).toBe(1); // run 은 정리
    // 이슈 status 는 closed 유지 (done 으로 안 바뀜).
    expect(db.select().from(issues).where(eq(issues.id, issueId)).get()?.status).toBe('closed');
    // run 은 마감됨.
    expect(db.select().from(agentRuns).where(eq(agentRuns.id, runId)).get()?.status).toBe(
      'completed',
    );
  });
});

describe('finishAgentRun — terminal status 가드', () => {
  // 회귀(리뷰 발견): reconcileStaleRuns 가 24h 후 'failed' 로 마감한 run 을, 실은 아직 살아있던
  // 세션의 늦은 정상 exit 이 'completed' 로 되돌려 sweep 감사 신호를 지웠다. 이제 terminal 이면 no-op.
  it('이미 failed 인 run 은 finishAgentRun(ok=true) 가 덮어쓰지 않음', () => {
    const repoId = seedProject('repo');
    const runId = startAgentRun(seedIssue(repoId, 'x', 'in-progress'));
    finishAgentRun(runId, false); // failed
    const failedAt = db.select().from(agentRuns).where(eq(agentRuns.id, runId)).get()?.completedAt;

    finishAgentRun(runId, true); // 늦은 정상 exit — 무시돼야
    const after = db.select().from(agentRuns).where(eq(agentRuns.id, runId)).get();
    expect(after?.status).toBe('failed'); // 여전히 failed
    expect(after?.completedAt).toEqual(failedAt); // completedAt 도 안 바뀜
  });

  it('running run 은 정상 마감 (가드가 정상 흐름 막지 않음)', () => {
    const repoId = seedProject('repo');
    const runId = startAgentRun(seedIssue(repoId, 'y', 'in-progress'));
    finishAgentRun(runId, true);
    expect(db.select().from(agentRuns).where(eq(agentRuns.id, runId)).get()?.status).toBe(
      'completed',
    );
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

  it('exposes projectId', () => {
    const repoId = seedProject('proj');
    const issueId = seedIssue(repoId, 'has project');
    expect(getIssueDetail(issueId)!.projectId).toBe(repoId);
  });
});

describe('listIssueOptions', () => {
  it('returns id + title + project slug, newest-first', () => {
    const repoId = seedProject('cortex');
    seedIssue(repoId, 'older');
    seedIssue(repoId, 'newer');

    const opts = listIssueOptions();
    expect(opts).toHaveLength(2);
    // 최신 순 — 큰 id 먼저.
    expect(opts[0].title).toBe('newer');
    expect(opts[0].projectSlug).toBe('cortex');
    expect(opts[1].title).toBe('older');
  });

  it('returns empty when no issues', () => {
    expect(listIssueOptions()).toEqual([]);
  });
});

describe('getIssueContextForPR — Phase 4.7 사전 리뷰 컨텍스트', () => {
  function seedPR(repoId: number, number: number): number {
    return db
      .insert(prs)
      .values({
        repoId,
        number,
        title: 'fix',
        authorKind: 'agent',
        authorId: 'claude-code',
        headSha: 'sha',
        linesAdded: 1,
        linesRemoved: 0,
        filesChanged: 1,
        status: 'review-needed',
      })
      .returning({ id: prs.id })
      .get().id;
  }

  it('agent_run.outputPrId 가 매칭되면 이슈 title + spec 반환', () => {
    const repoId = seedProject('owner/repo');
    const issueId = db
      .insert(issues)
      .values({
        repoId,
        title: '버그 수정',
        spec: '수용 기준 A, B, C',
        assigneeKind: 'agent',
        assigneeId: 'claude',
        status: 'in-progress',
      })
      .returning({ id: issues.id })
      .get().id;
    const prId = seedPR(repoId, 1);
    db.insert(agentRuns).values({ issueId, agent: 'claude', outputPrId: prId }).run();
    const ctx = getIssueContextForPR(prId);
    expect(ctx).toEqual({ title: '버그 수정', spec: '수용 기준 A, B, C' });
  });

  it('매칭되는 agent_run 이 없으면 null (사람 PR 등)', () => {
    const repoId = seedProject('owner/repo');
    const prId = seedPR(repoId, 1);
    expect(getIssueContextForPR(prId)).toBeNull();
  });

  it('한 PR 에 agent_run 이 여러 개면 최신(큰 id) 의 issue spec 반환', () => {
    const repoId = seedProject('owner/repo');
    const issueA = db
      .insert(issues)
      .values({
        repoId,
        title: 'A',
        spec: 'spec A',
        assigneeKind: 'agent',
        assigneeId: 'claude',
        status: 'done',
      })
      .returning({ id: issues.id })
      .get().id;
    const issueB = db
      .insert(issues)
      .values({
        repoId,
        title: 'B',
        spec: 'spec B',
        assigneeKind: 'agent',
        assigneeId: 'claude',
        status: 'in-progress',
      })
      .returning({ id: issues.id })
      .get().id;
    const prId = seedPR(repoId, 1);
    db.insert(agentRuns).values({ issueId: issueA, agent: 'claude', outputPrId: prId }).run();
    db.insert(agentRuns).values({ issueId: issueB, agent: 'claude', outputPrId: prId }).run();
    const ctx = getIssueContextForPR(prId);
    expect(ctx?.title).toBe('B');
  });
});

describe('extractCortexIssueRef', () => {
  it('본문의 `Cortex-Issue: #<id>` trailer 추출', () => {
    expect(extractCortexIssueRef('변경 요약\n\nCortex-Issue: #42')).toBe(42);
    expect(extractCortexIssueRef('cortex-issue:   #7')).toBe(7); // 대소문자·공백 관대
  });
  it('마커 없거나 형식 안 맞으면 null', () => {
    expect(extractCortexIssueRef('일반 PR 본문')).toBeNull();
    expect(extractCortexIssueRef('Cortex-Issue: 42')).toBeNull(); // # 없음
    expect(extractCortexIssueRef(null)).toBeNull();
    expect(extractCortexIssueRef(undefined)).toBeNull();
  });
});

describe('linkOutputPrFromBody — agent_run ↔ 결과 PR 연결', () => {
  function seedPRWithBody(repoId: number, number: number, body: string | null): number {
    return db
      .insert(prs)
      .values({
        repoId,
        number,
        title: 'result',
        body,
        authorKind: 'agent',
        authorId: 'claude',
        headSha: `sha-${number}`,
        linesAdded: 1,
        linesRemoved: 0,
        filesChanged: 1,
        status: 'review-needed',
      })
      .returning({ id: prs.id })
      .get().id;
  }
  function seedAgentIssue(repoId: number, title: string): number {
    return db
      .insert(issues)
      .values({ repoId, title, spec: `spec ${title}`, assigneeKind: 'agent', assigneeId: 'claude' })
      .returning({ id: issues.id })
      .get().id;
  }

  it('마커가 가리키는 이슈의 최신 run 에 outputPrId 세팅 → getIssueContextForPR 동작', () => {
    const repoId = seedProject('owner/repo');
    const issueId = seedAgentIssue(repoId, 'feat X');
    const runId = startAgentRun(issueId);
    const prId = seedPRWithBody(repoId, 1, `요약\n\nCortex-Issue: #${issueId}`);

    expect(linkOutputPrFromBody(prId)).toBe(true);
    expect(db.select().from(agentRuns).where(eq(agentRuns.id, runId)).get()?.outputPrId).toBe(prId);
    // 이제 사전 리뷰 컨텍스트가 채워진다(Phase 4.7 되살아남).
    expect(getIssueContextForPR(prId)?.title).toBe('feat X');
  });

  it('마커 없으면 no-op (false)', () => {
    const repoId = seedProject('owner/repo');
    seedAgentIssue(repoId, 'x');
    const prId = seedPRWithBody(repoId, 1, '마커 없는 본문');
    expect(linkOutputPrFromBody(prId)).toBe(false);
  });

  it('cross-project 누수 가드 — 다른 repo 의 이슈는 연결 안 함', () => {
    const repoA = seedProject('owner/a');
    const repoB = seedProject('owner/b');
    const issueInB = seedAgentIssue(repoB, 'B 이슈');
    startAgentRun(issueInB);
    // repoA 의 PR 이 repoB 의 이슈를 가리키는 마커 — 연결되면 안 됨.
    const prId = seedPRWithBody(repoA, 1, `Cortex-Issue: #${issueInB}`);
    expect(linkOutputPrFromBody(prId)).toBe(false);
    expect(getIssueContextForPR(prId)).toBeNull();
  });

  it('존재하지 않는 이슈 id 마커는 no-op', () => {
    const repoId = seedProject('owner/repo');
    const prId = seedPRWithBody(repoId, 1, 'Cortex-Issue: #99999');
    expect(linkOutputPrFromBody(prId)).toBe(false);
  });
});
