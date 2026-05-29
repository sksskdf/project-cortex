import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/client';
import { agentRuns, issues, prs, projects } from '@/db/schema';
import {
  clearAutomationInFlight,
  countAutomationInFlight,
  setAutomationInFlight,
} from './automation-state';
import { getLiveStatus } from './live-status';

beforeAll(() => {
  migrate(db, { migrationsFolder: 'src/db/migrations' });
});

beforeEach(() => {
  db.delete(agentRuns).run();
  db.delete(issues).run();
  db.delete(prs).run();
  db.delete(projects).run();
  // 인메모리 자동화 레지스트리 초기화.
  for (let i = 0; i < 50; i++) clearAutomationInFlight(i);
});

afterEach(() => {
  for (let i = 0; i < 50; i++) clearAutomationInFlight(i);
});

let slugSeq = 0;
function project(muted = false): number {
  slugSeq += 1;
  return db
    .insert(projects)
    .values({ slug: `a/b${slugSeq}`, name: 'b', muted })
    .returning({ id: projects.id })
    .get().id;
}

function pr(repoId: number, n: number, status: 'review-needed' | 'merged', readAt: Date | null) {
  db.insert(prs)
    .values({
      repoId,
      number: n,
      title: `p${n}`,
      authorKind: 'agent',
      authorId: 'x',
      headSha: `s${n}`,
      linesAdded: 1,
      linesRemoved: 0,
      filesChanged: 1,
      status,
      readAt,
    })
    .run();
}

function issue(repoId: number): number {
  return db
    .insert(issues)
    .values({ repoId, title: 'i', spec: 's', assigneeKind: 'agent', assigneeId: 'x' })
    .returning({ id: issues.id })
    .get().id;
}

describe('getLiveStatus', () => {
  it('빈 상태는 모두 0', () => {
    expect(getLiveStatus()).toEqual({
      activeDelegations: 0,
      automationInFlight: 0,
      reviewPending: 0,
      unreadMerges: 0,
    });
  });

  it('진행 중 위임 = running/queued agent_runs 만 집계', () => {
    const repoId = project();
    const iid = issue(repoId);
    db.insert(agentRuns).values({ issueId: iid, agent: 'claude', status: 'running' }).run();
    db.insert(agentRuns).values({ issueId: iid, agent: 'claude', status: 'queued' }).run();
    db.insert(agentRuns).values({ issueId: iid, agent: 'claude', status: 'completed' }).run();
    expect(getLiveStatus().activeDelegations).toBe(2);
  });

  it('검토 대기 = review-needed (뮤트 프로젝트 제외)', () => {
    const open = project(false);
    const muted = project(true);
    pr(open, 1, 'review-needed', null);
    pr(muted, 2, 'review-needed', null); // 뮤트 → 제외
    expect(getLiveStatus().reviewPending).toBe(1);
  });

  it('미확인 머지 = merged + readAt null 만', () => {
    const repoId = project();
    pr(repoId, 1, 'merged', null); // 미확인
    pr(repoId, 2, 'merged', new Date()); // 확인됨 → 제외
    pr(repoId, 3, 'review-needed', null); // 머지 아님 → 제외
    expect(getLiveStatus().unreadMerges).toBe(1);
  });

  it('자동화 in-flight = 레지스트리 크기', () => {
    setAutomationInFlight(1, 'fixing-tests');
    setAutomationInFlight(2, 'resolving-conflict');
    expect(countAutomationInFlight()).toBe(2);
    expect(getLiveStatus().automationInFlight).toBe(2);
    clearAutomationInFlight(1);
    expect(getLiveStatus().automationInFlight).toBe(1);
  });
});
