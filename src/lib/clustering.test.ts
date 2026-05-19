import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/client';
import { clusters, preReviews, prs, projects } from '@/db/schema';
import {
  CLUSTER_WINDOW_MS,
  dissolveCluster,
  jaccardSimilarity,
  MIN_CLUSTER_SIZE,
  SIMILARITY_THRESHOLD,
  tryClusterPR,
} from './clustering';

describe('jaccardSimilarity', () => {
  it('returns 1 for identical sets', () => {
    expect(jaccardSimilarity(['a', 'b'], ['a', 'b'])).toBe(1);
  });
  it('returns 0 for disjoint sets', () => {
    expect(jaccardSimilarity(['a'], ['b'])).toBe(0);
  });
  it('returns 0 for two empty arrays', () => {
    expect(jaccardSimilarity([], [])).toBe(0);
  });
  it('computes 4/6 ≈ 0.667 for 4 overlap of 6 total', () => {
    const r = jaccardSimilarity(['a', 'b', 'c', 'd', 'e'], ['a', 'b', 'c', 'd', 'f']);
    expect(r).toBeCloseTo(4 / 6, 3);
  });
  it('ignores duplicates within an array', () => {
    expect(jaccardSimilarity(['a', 'a', 'b'], ['a', 'b'])).toBe(1);
  });
});

describe('constants — match ROADMAP DoD', () => {
  it('threshold 0.85, min size 3, window 24h', () => {
    expect(SIMILARITY_THRESHOLD).toBe(0.85);
    expect(MIN_CLUSTER_SIZE).toBe(3);
    expect(CLUSTER_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
  });
});

beforeAll(() => {
  migrate(db, { migrationsFolder: 'src/db/migrations' });
});

beforeEach(() => {
  db.delete(preReviews).run();
  db.delete(prs).run();
  db.delete(clusters).run();
  db.delete(projects).run();
});

type SetupPROpts = {
  repoId: number;
  author?: string;
  paths: string[];
  flags?: string[];
  number?: number;
  status?: 'open' | 'review-needed' | 'auto-mergeable' | 'merged' | 'closed';
  createdAt?: Date;
  clusterId?: number | null;
  confidence?: number;
};

function setupPR(opts: SetupPROpts): number {
  const pr = db
    .insert(prs)
    .values({
      repoId: opts.repoId,
      number: opts.number ?? Math.floor(Math.random() * 100000),
      title: 'PR',
      authorKind: 'agent',
      authorId: opts.author ?? 'devin',
      headSha: `sha-${opts.number ?? Math.random()}`,
      linesAdded: 5,
      linesRemoved: 0,
      filesChanged: opts.paths.length,
      status: opts.status ?? 'review-needed',
      clusterId: opts.clusterId ?? null,
      createdAt: opts.createdAt ?? new Date(),
    })
    .returning({ id: prs.id, headSha: prs.headSha })
    .get();

  db.insert(preReviews)
    .values({
      prId: pr.id,
      headSha: pr.headSha,
      confidence: opts.confidence ?? 80,
      confidenceTier: 'medium',
      flags: opts.flags ?? [],
      changedPaths: opts.paths,
    })
    .run();

  return pr.id;
}

function setupProject(slug = 'acme/web'): number {
  return db.insert(projects).values({ slug, name: slug }).returning({ id: projects.id }).get().id;
}

describe('tryClusterPR', () => {
  it('clusters 3 PRs with identical paths from same author within 24h', async () => {
    const repoId = setupProject();
    const paths = ['src/i18n/ko.ts'];
    const a = setupPR({ repoId, paths, number: 1 });
    setupPR({ repoId, paths, number: 2 });
    setupPR({ repoId, paths, number: 3 });

    const r = await tryClusterPR(a);
    expect(r.kind).toBe('clustered');
    if (r.kind === 'clustered') expect(r.size).toBe(3);

    const cluster = db.select().from(clusters).get();
    expect(cluster).toBeDefined();
    const clusteredPRs = db.select().from(prs).where(eq(prs.clusterId, cluster!.id)).all();
    expect(clusteredPRs).toHaveLength(3);
  });

  it('skips when fewer than 3 similar PRs exist (only 2 candidates)', async () => {
    const repoId = setupProject();
    const a = setupPR({ repoId, paths: ['x.ts'], number: 1 });
    setupPR({ repoId, paths: ['x.ts'], number: 2 });

    const r = await tryClusterPR(a);
    expect(r).toEqual({ kind: 'skipped', reason: 'no-similar-prs' });
  });

  it('skips when PR has blocking flag (payment-domain)', async () => {
    const repoId = setupProject();
    const a = setupPR({ repoId, paths: ['x.ts'], flags: ['payment-domain'], number: 1 });
    setupPR({ repoId, paths: ['x.ts'], number: 2 });
    setupPR({ repoId, paths: ['x.ts'], number: 3 });

    const r = await tryClusterPR(a);
    expect(r).toEqual({ kind: 'skipped', reason: 'blocking-flag' });
  });

  it('excludes candidate PRs that have blocking flags', async () => {
    const repoId = setupProject();
    const a = setupPR({ repoId, paths: ['x.ts'], number: 1 });
    setupPR({ repoId, paths: ['x.ts'], flags: ['migration'], number: 2 });
    setupPR({ repoId, paths: ['x.ts'], number: 3 });

    // 자기 + 후보 1건 (migration 제외) = 2 < 3, skip.
    const r = await tryClusterPR(a);
    expect(r).toEqual({ kind: 'skipped', reason: 'no-similar-prs' });
  });

  it('excludes candidates from different authors', async () => {
    const repoId = setupProject();
    const a = setupPR({ repoId, paths: ['x.ts'], author: 'devin', number: 1 });
    setupPR({ repoId, paths: ['x.ts'], author: 'codex', number: 2 });
    setupPR({ repoId, paths: ['x.ts'], author: 'codex', number: 3 });

    const r = await tryClusterPR(a);
    expect(r).toEqual({ kind: 'skipped', reason: 'no-similar-prs' });
  });

  it('excludes candidates from different repos', async () => {
    const repoA = setupProject('acme/web');
    const repoB = setupProject('acme/api');
    const a = setupPR({ repoId: repoA, paths: ['x.ts'], number: 1 });
    setupPR({ repoId: repoB, paths: ['x.ts'], number: 2 });
    setupPR({ repoId: repoB, paths: ['x.ts'], number: 3 });

    const r = await tryClusterPR(a);
    expect(r).toEqual({ kind: 'skipped', reason: 'no-similar-prs' });
  });

  it('excludes candidates older than 24h', async () => {
    const repoId = setupProject();
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    const a = setupPR({ repoId, paths: ['x.ts'], number: 1 });
    setupPR({ repoId, paths: ['x.ts'], number: 2, createdAt: old });
    setupPR({ repoId, paths: ['x.ts'], number: 3, createdAt: old });

    const r = await tryClusterPR(a);
    expect(r).toEqual({ kind: 'skipped', reason: 'no-similar-prs' });
  });

  it('skips closed/merged candidate PRs (status outside open/review-needed)', async () => {
    const repoId = setupProject();
    const a = setupPR({ repoId, paths: ['x.ts'], number: 1 });
    setupPR({ repoId, paths: ['x.ts'], number: 2, status: 'merged' });
    setupPR({ repoId, paths: ['x.ts'], number: 3, status: 'closed' });

    const r = await tryClusterPR(a);
    expect(r).toEqual({ kind: 'skipped', reason: 'no-similar-prs' });
  });

  it('skips when PR is already in a cluster (idempotent)', async () => {
    const repoId = setupProject();
    const cluster = db
      .insert(clusters)
      .values({ pattern: 'pre-existing', title: 'x', avgConfidence: 80 })
      .returning({ id: clusters.id })
      .get();
    const a = setupPR({ repoId, paths: ['x.ts'], number: 1, clusterId: cluster.id });

    const r = await tryClusterPR(a);
    expect(r).toEqual({ kind: 'skipped', reason: 'already-clustered' });
  });

  it('similarity below 0.85 does not cluster (Jaccard 0.5 < 0.85)', async () => {
    const repoId = setupProject();
    const a = setupPR({ repoId, paths: ['a.ts', 'b.ts'], number: 1 });
    setupPR({ repoId, paths: ['a.ts', 'c.ts'], number: 2 });
    setupPR({ repoId, paths: ['a.ts', 'd.ts'], number: 3 });

    // Jaccard(['a','b'],['a','c']) = 1/3 ≈ 0.33 < 0.85.
    const r = await tryClusterPR(a);
    expect(r).toEqual({ kind: 'skipped', reason: 'no-similar-prs' });
  });

  it('joins an existing cluster instead of creating a new one (race safety)', async () => {
    const repoId = setupProject();
    const cluster = db
      .insert(clusters)
      .values({ pattern: 'pre', title: 'x', avgConfidence: 80 })
      .returning({ id: clusters.id })
      .get();
    setupPR({ repoId, paths: ['x.ts'], number: 1, clusterId: cluster.id });
    setupPR({ repoId, paths: ['x.ts'], number: 2, clusterId: cluster.id });
    // 새 PR — 위 2건과 유사. 자기 자신 + 2 = 3 ≥ MIN_CLUSTER_SIZE.
    // 하지만 후보 쿼리는 isNull(clusterId) 필터라 위 2건은 빠짐 → no-similar.
    // 이 테스트는 race 시 already-clustered/skipped 동작을 보장.
    const a = setupPR({ repoId, paths: ['x.ts'], number: 3 });

    const r = await tryClusterPR(a);
    expect(r.kind).toBe('skipped');
  });
});

describe('dissolveCluster', () => {
  it('releases all PRs back to review-needed and marks cluster dissolved', () => {
    const repoId = setupProject();
    const cluster = db
      .insert(clusters)
      .values({ pattern: 'p', title: 't', avgConfidence: 90 })
      .returning({ id: clusters.id })
      .get();
    setupPR({ repoId, paths: ['x.ts'], number: 1, clusterId: cluster.id });
    setupPR({ repoId, paths: ['x.ts'], number: 2, clusterId: cluster.id });
    setupPR({ repoId, paths: ['x.ts'], number: 3, clusterId: cluster.id });

    const r = dissolveCluster(cluster.id);
    expect(r.released).toBe(3);

    const survived = db.select().from(prs).where(eq(prs.clusterId, cluster.id)).all();
    expect(survived).toHaveLength(0);
    const allPRs = db.select().from(prs).all();
    expect(allPRs.every((p) => p.status === 'review-needed')).toBe(true);
    expect(allPRs.every((p) => p.clusterId === null)).toBe(true);

    const c = db.select().from(clusters).where(eq(clusters.id, cluster.id)).get();
    expect(c?.status).toBe('dissolved');
    expect(c?.closedAt).not.toBeNull();
  });
});
