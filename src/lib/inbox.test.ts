import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/client';
import { preReviews, prs, projects, triageDecisions } from '@/db/schema';
import { listInboxQueue, type InboxCategoryId } from './inbox';

beforeAll(() => {
  migrate(db, { migrationsFolder: 'src/db/migrations' });
});

beforeEach(() => {
  db.delete(triageDecisions).run();
  db.delete(preReviews).run();
  db.delete(prs).run();
  db.delete(projects).run();
});

function setupProject(slug = 'acme/web'): number {
  return db.insert(projects).values({ slug, name: slug }).returning({ id: projects.id }).get().id;
}

function setupPR(opts: { repoId: number; number: number; flags?: string[]; confidence?: number }) {
  const pr = db
    .insert(prs)
    .values({
      repoId: opts.repoId,
      number: opts.number,
      title: `PR ${opts.number}`,
      authorKind: 'agent',
      authorId: 'devin',
      headSha: `sha-${opts.number}`,
      linesAdded: 10,
      linesRemoved: 1,
      filesChanged: 1,
      status: 'review-needed',
    })
    .returning({ id: prs.id })
    .get();
  db.insert(preReviews)
    .values({
      prId: pr.id,
      headSha: `sha-${opts.number}`,
      confidence: opts.confidence ?? 70,
      confidenceTier: 'medium',
      flags: opts.flags ?? [],
    })
    .run();
  // tone='alert' 검증을 위해 triageDecisions 도 넣음 — flagged 카테고리는 reasonTone 결과 기반.
  db.insert(triageDecisions)
    .values({
      prId: pr.id,
      decision: 'human-review',
      reason: 'test',
      decidedBy: 'system',
    })
    .run();
  return pr.id;
}

async function listByCategory(category: InboxCategoryId): Promise<number[]> {
  const items = await listInboxQueue(category);
  return items.map((i) => Number(i.id.replace('pr-', '')));
}

describe('listInboxQueue — 카테고리 필터', () => {
  it('all (디폴트) — review-needed 인 모든 PR', async () => {
    const repoId = setupProject();
    const a = setupPR({ repoId, number: 1, flags: [] });
    const b = setupPR({ repoId, number: 2, flags: ['large-change'] });
    const c = setupPR({ repoId, number: 3, flags: ['migration'] });

    const ids = await listByCategory('all');
    expect(ids.sort()).toEqual([a, b, c].sort());
  });

  it('flagged — 위험 플래그가 있는 PR (reason.tone=alert)', async () => {
    const repoId = setupProject();
    setupPR({ repoId, number: 1, flags: [] });
    const paid = setupPR({ repoId, number: 2, flags: ['payment-domain'] });
    const auth = setupPR({ repoId, number: 3, flags: ['auth-domain'] });

    const ids = await listByCategory('flagged');
    expect(ids.sort()).toEqual([paid, auth].sort());
  });

  it('large — large-change 플래그만', async () => {
    const repoId = setupProject();
    setupPR({ repoId, number: 1, flags: [] });
    const big = setupPR({ repoId, number: 2, flags: ['large-change'] });
    setupPR({ repoId, number: 3, flags: ['migration'] });

    expect(await listByCategory('large')).toEqual([big]);
  });

  it('migration — migration 플래그만', async () => {
    const repoId = setupProject();
    setupPR({ repoId, number: 1, flags: [] });
    setupPR({ repoId, number: 2, flags: ['large-change'] });
    const mig = setupPR({ repoId, number: 3, flags: ['migration'] });

    expect(await listByCategory('migration')).toEqual([mig]);
  });

  it('cluster / mentioned — 인박스 흐름 밖이라 빈 배열', async () => {
    const repoId = setupProject();
    setupPR({ repoId, number: 1, flags: [] });
    setupPR({ repoId, number: 2, flags: ['migration'] });

    expect(await listByCategory('cluster')).toEqual([]);
    expect(await listByCategory('mentioned')).toEqual([]);
  });

  it('빈 DB → 모든 카테고리 빈 배열', async () => {
    expect(await listByCategory('all')).toEqual([]);
    expect(await listByCategory('flagged')).toEqual([]);
    expect(await listByCategory('large')).toEqual([]);
    expect(await listByCategory('migration')).toEqual([]);
    expect(await listByCategory('done')).toEqual([]);
  });

  it('done — merged/closed PR 만 (review-needed 제외) + clusterId 무관', async () => {
    const repoId = setupProject();
    const open = setupPR({ repoId, number: 1, flags: [] }); // review-needed
    const merged = db
      .insert(prs)
      .values({
        repoId,
        number: 2,
        title: 'merged',
        authorKind: 'agent',
        authorId: 'devin',
        headSha: 'sha-2',
        linesAdded: 1,
        linesRemoved: 0,
        filesChanged: 1,
        status: 'merged',
      })
      .returning({ id: prs.id })
      .get();
    const closed = db
      .insert(prs)
      .values({
        repoId,
        number: 3,
        title: 'closed',
        authorKind: 'agent',
        authorId: 'devin',
        headSha: 'sha-3',
        linesAdded: 1,
        linesRemoved: 0,
        filesChanged: 1,
        status: 'closed',
      })
      .returning({ id: prs.id })
      .get();

    const ids = await listByCategory('done');
    expect(ids.sort()).toEqual([merged.id, closed.id].sort());
    // open 은 'all' 에는 잡히지만 'done' 엔 없음.
    expect(await listByCategory('all')).toEqual([open]);
  });
});
