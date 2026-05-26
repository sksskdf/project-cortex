import type { Octokit } from '@octokit/rest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/client';
import { notifications, preReviews, prs, projects, triageDecisions } from '@/db/schema';
import { setOctokit } from './github';
import { reconcileProject } from './reconcile';

// GitHub pulls.list (state='all') 응답 한 건. reconcile → listOpenPullRequests 가 읽는 필드만.
type ListPR = {
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  mergedAt: string | null;
};

function mockOctokitList(items: ReadonlyArray<ListPR>): Octokit {
  const data = items.map((p) => ({
    number: p.number,
    title: p.title,
    body: p.body,
    state: p.state,
    merged_at: p.mergedAt,
    head: { sha: `sha-${p.number}` },
    user: { login: 'devin', type: 'User' },
    created_at: '2026-05-18T00:00:00Z',
    updated_at: '2026-05-18T00:00:00Z',
  }));
  return {
    pulls: {
      list: vi.fn().mockResolvedValue({ data }),
      get: vi.fn().mockResolvedValue({ data: {} }),
      merge: vi.fn().mockResolvedValue({ data: { merged: true, sha: 'x' } }),
    },
  } as unknown as Octokit;
}

let projectId: number;

beforeAll(() => {
  migrate(db, { migrationsFolder: 'src/db/migrations' });
});

beforeEach(() => {
  db.delete(notifications).run();
  db.delete(triageDecisions).run();
  db.delete(preReviews).run();
  db.delete(prs).run();
  db.delete(projects).run();
  const project = db
    .insert(projects)
    .values({ slug: 'acme/web', name: 'Acme Web', installationId: 555, autoMergeEnabled: true })
    .returning({ id: projects.id })
    .get();
  projectId = project.id;
});

afterEach(() => {
  setOctokit(null);
});

function getPr(number: number) {
  return db
    .select()
    .from(prs)
    .where(and(eq(prs.repoId, projectId), eq(prs.number, number)))
    .get();
}

describe('reconcileProject — GitHub 실제 state/merged 반영', () => {
  it('머지된 PR 은 status=merged 로 들어와 인박스(review-needed)에 안 잡힌다', async () => {
    setOctokit(
      mockOctokitList([
        {
          number: 73,
          title: 'docs',
          body: null,
          state: 'closed',
          mergedAt: '2026-05-10T00:00:00Z',
        },
      ]),
    );

    const result = await reconcileProject(projectId);

    expect(result.kind).toBe('reconciled');
    expect(getPr(73)?.status).toBe('merged');
  });

  it('머지 안 하고 닫힌 PR 은 status=closed', async () => {
    setOctokit(
      mockOctokitList([{ number: 74, title: 'wip', body: null, state: 'closed', mergedAt: null }]),
    );

    await reconcileProject(projectId);

    expect(getPr(74)?.status).toBe('closed');
  });

  it('이미 머지된 PR 을 재동기화해도 auto-merged 알림을 만들지 않는다', async () => {
    setOctokit(
      mockOctokitList([
        {
          number: 73,
          title: 'docs',
          body: null,
          state: 'closed',
          mergedAt: '2026-05-10T00:00:00Z',
        },
      ]),
    );

    await reconcileProject(projectId);
    await reconcileProject(projectId);

    const autoMerged = db
      .select()
      .from(notifications)
      .where(eq(notifications.kind, 'auto-merged'))
      .all();
    expect(autoMerged).toHaveLength(0);
  });

  it('stale review-needed PR 이 GitHub 에서 머지됐으면 merged 로 정정된다 (인박스 정리)', async () => {
    // 과거 reconcile 버그로 review-needed 로 되살아난 PR 을 시뮬레이션.
    db.insert(prs)
      .values({
        repoId: projectId,
        number: 80,
        title: 'old merged pr',
        authorKind: 'agent',
        authorId: 'devin',
        headSha: 'sha-80',
        linesAdded: 0,
        linesRemoved: 0,
        filesChanged: 0,
        status: 'review-needed',
      })
      .run();

    setOctokit(
      mockOctokitList([
        {
          number: 80,
          title: 'old merged pr',
          body: null,
          state: 'closed',
          mergedAt: '2026-05-09T00:00:00Z',
        },
      ]),
    );

    await reconcileProject(projectId);

    expect(getPr(80)?.status).toBe('merged');
  });

  it('실제 open PR 은 reconcile 후에도 인박스에 남는다 (review-needed)', async () => {
    setOctokit(
      mockOctokitList([
        { number: 90, title: 'open pr', body: null, state: 'open', mergedAt: null },
      ]),
    );

    await reconcileProject(projectId);

    // reconcile 은 AI 분석을 bypass → preReview 없음 → triage skip → review-needed 폴백.
    expect(getPr(90)?.status).toBe('review-needed');
  });
});
