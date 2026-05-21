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

  // 검색 — 제목 LIKE 부분 일치.
  it('search — 제목 부분 일치만 반환', async () => {
    const repoId = setupProject();
    setupPR({ repoId, number: 1, flags: [] }); // title="PR 1"
    setupPR({ repoId, number: 42, flags: [] }); // title="PR 42"

    const items = await listInboxQueue('all', '42');
    expect(items.map((p) => p.number)).toEqual([42]);
  });

  it('search — repo slug 부분 일치도 매칭', async () => {
    const a = setupProject('acme/web');
    const b = setupProject('foo/api');
    setupPR({ repoId: a, number: 1, flags: [] });
    setupPR({ repoId: b, number: 2, flags: [] });

    const items = await listInboxQueue('all', 'acme');
    expect(items.map((p) => p.repo)).toEqual(['acme/web']);
  });

  it('search — 빈 문자열은 전체 통과', async () => {
    const repoId = setupProject();
    setupPR({ repoId, number: 1, flags: [] });
    setupPR({ repoId, number: 2, flags: [] });

    const items = await listInboxQueue('all', '   ');
    expect(items.length).toBe(2);
  });

  // 새 push 들어왔을 때 ageText 가 갱신되는지 — createdAt 대신 updatedAt 우선 사용해야.
  it('ageText 는 updatedAt 기준 — 새 push 후 "방금 전" 으로 갱신', async () => {
    const repoId = setupProject();
    const now = Date.now();
    // 22분 전에 PR 이 만들어졌지만 방금 새 push 가 들어옴 (updatedAt = now).
    const pr = db
      .insert(prs)
      .values({
        repoId,
        number: 99,
        title: 'recently pushed',
        authorKind: 'agent',
        authorId: 'devin',
        headSha: 'sha-99',
        linesAdded: 1,
        linesRemoved: 0,
        filesChanged: 1,
        status: 'review-needed',
        createdAt: new Date(now - 22 * 60 * 1000),
        updatedAt: new Date(now - 10 * 1000),
      })
      .returning({ id: prs.id })
      .get();
    db.insert(preReviews)
      .values({
        prId: pr.id,
        headSha: 'sha-99',
        confidence: 80,
        confidenceTier: 'medium',
        flags: [],
      })
      .run();

    const items = await listInboxQueue('all');
    const target = items.find((p) => p.id === `pr-${pr.id}`);
    // formatRelativeAge: <1분 → "방금 전". createdAt 기준이면 "22분 전" 이 됨.
    expect(target?.ageText).toBe('방금 전');
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
