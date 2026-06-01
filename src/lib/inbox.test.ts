import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/client';
import { clusters, preReviews, prs, projects, triageDecisions } from '@/db/schema';
import { currentUser } from '@/lib/config';
import {
  deriveRowActions,
  getInboxCategories,
  getInboxProjects,
  getSidebarCounts,
  listInboxQueue,
  type InboxCategoryId,
} from './inbox';

describe('deriveRowActions', () => {
  it('installation 없는 시드 PR — 모두 비활성', () => {
    const r = deriveRowActions('review-needed', null, null);
    expect(r.canMerge).toBe(false);
    expect(r.canClose).toBe(false);
    expect(r.mergeBlockedByCI).toBeFalsy();
  });

  it('CI 통과 + 활성 — 머지/닫기 모두 가능', () => {
    const r = deriveRowActions('review-needed', 123, true);
    expect(r.canMerge).toBe(true);
    expect(r.canClose).toBe(true);
    expect(r.mergeBlockedByCI).toBe(false);
  });

  it('CI 대기 (testsPassed=null) — 머지 차단, 닫기 가능, mergeBlockedByCI=true', () => {
    const r = deriveRowActions('review-needed', 123, null);
    expect(r.canMerge).toBe(false);
    expect(r.canClose).toBe(true);
    expect(r.mergeBlockedByCI).toBe(true);
  });

  it('CI 실패 (testsPassed=false) — 머지 차단, 닫기 가능', () => {
    const r = deriveRowActions('review-needed', 123, false);
    expect(r.canMerge).toBe(false);
    expect(r.canClose).toBe(true);
    expect(r.mergeBlockedByCI).toBe(true);
  });

  it('이미 머지된 PR — 둘 다 비활성', () => {
    const r = deriveRowActions('merged', 123, true);
    expect(r.canMerge).toBe(false);
    expect(r.canClose).toBe(false);
  });
});

beforeAll(() => {
  migrate(db, { migrationsFolder: 'src/db/migrations' });
});

beforeEach(() => {
  db.delete(triageDecisions).run();
  db.delete(preReviews).run();
  db.delete(prs).run();
  db.delete(clusters).run();
  db.delete(projects).run();
});

function setupProject(slug = 'acme/web', muted = false): number {
  return db
    .insert(projects)
    .values({ slug, name: slug, muted })
    .returning({ id: projects.id })
    .get().id;
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

  // done 카테고리의 머지/닫힘 PR 은 위험 강조 (warn/alert) stripe 안 띠움 — 이미 처리 끝.
  it('done — merged/closed PR 의 reason.tone 은 항상 info (위험 stripe 표시 안 함)', async () => {
    const repoId = setupProject();
    const merged = db
      .insert(prs)
      .values({
        repoId,
        number: 1,
        title: 'risky merged PR',
        authorKind: 'agent',
        authorId: 'devin',
        headSha: 'sha-1',
        linesAdded: 1,
        linesRemoved: 0,
        filesChanged: 1,
        status: 'merged',
      })
      .returning({ id: prs.id })
      .get();
    // confidence 낮음 + 위험 플래그까지 — review-needed 였으면 'alert' stripe 발생할 조건.
    db.insert(preReviews)
      .values({
        prId: merged.id,
        headSha: 'sha-1',
        confidence: 30,
        confidenceTier: 'critical',
        flags: ['payment-domain'],
      })
      .run();
    db.insert(triageDecisions)
      .values({
        prId: merged.id,
        decision: 'human-review',
        reason: 'risky',
        decidedBy: 'system',
      })
      .run();

    const items = await listInboxQueue('done');
    expect(items[0]?.reason.tone).toBe('info');
  });
});

describe('뮤트 프로젝트 — 인박스 표면에서 완전 제외', () => {
  it('listInboxQueue — 뮤트된 프로젝트의 review-needed PR 은 큐에서 빠짐', async () => {
    const active = setupProject('acme/web', false);
    const muted = setupProject('acme/muted', true);
    const visible = setupPR({ repoId: active, number: 1, flags: [] });
    setupPR({ repoId: muted, number: 2, flags: [] });

    const ids = (await listInboxQueue('all')).map((p) => Number(p.id.replace('pr-', '')));
    expect(ids).toEqual([visible]);
  });

  it('getSidebarCounts.inbox — 뮤트된 프로젝트 PR 은 카운트에서 제외', async () => {
    const active = setupProject('acme/web', false);
    const muted = setupProject('acme/muted', true);
    setupPR({ repoId: active, number: 1, flags: [] });
    setupPR({ repoId: active, number: 2, flags: [] });
    setupPR({ repoId: muted, number: 3, flags: [] });
    setupPR({ repoId: muted, number: 4, flags: [] });

    const counts = await getSidebarCounts();
    // 활성 프로젝트의 2건만 카운트 (뮤트 2건 제외). projects 카운트는 뮤트 포함 전체.
    expect(counts.inbox).toBe(2);
    expect(counts.projects).toBe(2);
  });

  it('getInboxProjects — 뮤트된 프로젝트는 레일에서 제외', async () => {
    const active = setupProject('acme/web', false);
    const muted = setupProject('acme/muted', true);
    setupPR({ repoId: active, number: 1, flags: [] });
    setupPR({ repoId: muted, number: 2, flags: [] });

    const rail = await getInboxProjects();
    expect(rail.map((p) => p.id)).toEqual(['acme/web']);
  });

  it('getInboxCategories — all/flagged/mentioned 카운트가 뮤트 PR 제외', async () => {
    const active = setupProject('acme/web', false);
    const muted = setupProject('acme/muted', true);
    // 활성: 일반 1 + flagged(payment) 1.
    setupPR({ repoId: active, number: 1, flags: [] });
    setupPR({ repoId: active, number: 2, flags: ['payment-domain'] });
    // 뮤트: 일반 1 + flagged 1 — 카운트에 잡히면 안 됨.
    setupPR({ repoId: muted, number: 3, flags: [] });
    setupPR({ repoId: muted, number: 4, flags: ['payment-domain'] });
    // 멘션: 활성 1 + 뮤트 1.
    const mentionBody = `cc @${currentUser.githubLogin}`;
    const activeMention = db
      .insert(prs)
      .values({
        repoId: active,
        number: 5,
        title: 'mention active',
        body: mentionBody,
        authorKind: 'agent',
        authorId: 'devin',
        headSha: 'sha-5',
        linesAdded: 1,
        linesRemoved: 0,
        filesChanged: 1,
        status: 'review-needed',
      })
      .returning({ id: prs.id })
      .get();
    db.insert(prs)
      .values({
        repoId: muted,
        number: 6,
        title: 'mention muted',
        body: mentionBody,
        authorKind: 'agent',
        authorId: 'devin',
        headSha: 'sha-6',
        linesAdded: 1,
        linesRemoved: 0,
        filesChanged: 1,
        status: 'review-needed',
      })
      .run();
    void activeMention;

    const cats = await getInboxCategories();
    const byId = Object.fromEntries(cats.map((c) => [c.id, c.count]));
    // all: 활성 일반1 + flagged1 + mention1 = 3 (뮤트 3건 제외).
    expect(byId.all).toBe(3);
    expect(byId.flagged).toBe(1);
    expect(byId.mentioned).toBe(1);
  });
});

// 카운트(배지)는 항상 대응하는 목록과 같은 필터여야 한다 — 둘이 어긋나면 배지(N) 인데 목록 0,
// 혹은 그 반대인 혼란이 생긴다. 아래는 리뷰에서 발견된 3건의 카운트↔목록 불일치 회귀 테스트.
describe('카운트 ↔ 목록 일치 (리뷰 회귀)', () => {
  // 임의 status·clusterId 로 PR 한 건 삽입 (setupPR 은 항상 review-needed·비클러스터라 부족).
  function insertRawPR(opts: {
    repoId: number;
    number: number;
    status: 'review-needed' | 'merged' | 'closed';
    clusterId?: number;
  }): number {
    return db
      .insert(prs)
      .values({
        repoId: opts.repoId,
        number: opts.number,
        title: `PR ${opts.number}`,
        authorKind: 'agent',
        authorId: 'devin',
        headSha: `sha-${opts.number}`,
        linesAdded: 1,
        linesRemoved: 0,
        filesChanged: 1,
        status: opts.status,
        clusterId: opts.clusterId ?? null,
      })
      .returning({ id: prs.id })
      .get().id;
  }

  function insertCluster(): number {
    return db
      .insert(clusters)
      .values({ pattern: 'p', title: 'cluster', avgConfidence: 80, status: 'open' })
      .returning({ id: clusters.id })
      .get().id;
  }

  it('done 카운트 = done 목록 길이 (뮤트 프로젝트 제외)', async () => {
    const active = setupProject('acme/web', false);
    const muted = setupProject('acme/muted', true);
    insertRawPR({ repoId: active, number: 1, status: 'merged' });
    insertRawPR({ repoId: active, number: 2, status: 'closed' });
    insertRawPR({ repoId: muted, number: 3, status: 'merged' }); // 뮤트 → 둘 다에서 제외돼야.

    const cats = await getInboxCategories();
    const doneCount = cats.find((c) => c.id === 'done')?.count ?? 0;
    const doneList = await listInboxQueue('done');
    // 예전: 카운트는 뮤트 미제외(3) → 목록(2)과 어긋남. 이제 둘 다 활성 2건.
    expect(doneCount).toBe(2);
    expect(doneList.length).toBe(doneCount);
  });

  it('프로젝트 레일 카운트 = 그 프로젝트의 인박스 큐 목록 길이 (review-needed·비클러스터만)', async () => {
    const repoId = setupProject('acme/web', false);
    const cid = insertCluster();
    setupPR({ repoId, number: 1 }); // review-needed·비클러스터 → 큐 대상.
    insertRawPR({ repoId, number: 2, status: 'merged' }); // 머지 → 큐 비대상.
    insertRawPR({ repoId, number: 3, status: 'review-needed', clusterId: cid }); // 클러스터 → 큐 비대상.

    const rail = await getInboxProjects();
    const railCount = rail.find((p) => p.id === 'acme/web')?.count ?? 0;
    const queue = await listInboxQueue('all', '', 'acme/web');
    // 예전: count(prs.id) 가 머지·클러스터까지 세어 3 → 실제 큐 목록(1)과 어긋남.
    expect(railCount).toBe(1);
    expect(queue.length).toBe(railCount);
  });

  it('cluster 카운트 = 활성 클러스터 PR (clusterId·review-needed·뮤트 아님)', async () => {
    const active = setupProject('acme/web', false);
    const muted = setupProject('acme/muted', true);
    const cid = insertCluster();
    insertRawPR({ repoId: active, number: 1, status: 'review-needed', clusterId: cid }); // 대상.
    insertRawPR({ repoId: active, number: 2, status: 'merged', clusterId: cid }); // 머지 → 제외.
    insertRawPR({ repoId: muted, number: 3, status: 'review-needed', clusterId: cid }); // 뮤트 → 제외.
    insertRawPR({ repoId: active, number: 4, status: 'review-needed' }); // 비클러스터 → 제외.

    const cats = await getInboxCategories();
    const clusterCount = cats.find((c) => c.id === 'cluster')?.count ?? 0;
    // 예전: triageDecisions.decision='cluster' 를 status/muted/clusterId 무관하게 세어 과대 계상.
    expect(clusterCount).toBe(1);
  });
});
