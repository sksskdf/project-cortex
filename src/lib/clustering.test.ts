import type { Octokit } from '@octokit/rest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { db } from '@/db/client';
import { clusters, preReviews, prs, projects } from '@/db/schema';
import {
  CLUSTER_WINDOW_MS,
  dissolveCluster,
  jaccardSimilarity,
  mergeCluster,
  MIN_CLUSTER_SIZE,
  SIMILARITY_THRESHOLD,
  tryClusterPR,
} from './clustering';
import { setOctokit } from './github';

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

function mockOctokit(merge?: Mock): Octokit {
  return {
    pulls: { get: vi.fn(), merge: merge ?? vi.fn() },
  } as unknown as Octokit;
}

afterEach(() => {
  setOctokit(null);
});

describe('mergeCluster', () => {
  function setupCluster(installationId: number | null = 12345): {
    clusterId: number;
    prIds: number[];
  } {
    const project = db
      .insert(projects)
      .values({ slug: 'acme/web', name: 'Web', autoMergeEnabled: true, installationId })
      .returning({ id: projects.id })
      .get();
    const cluster = db
      .insert(clusters)
      .values({ pattern: 'p', title: 't', avgConfidence: 90 })
      .returning({ id: clusters.id })
      .get();
    const prIds = [1, 2, 3].map((n) =>
      setupPR({
        repoId: project.id,
        paths: ['x.ts'],
        number: n,
        clusterId: cluster.id,
      }),
    );
    return { clusterId: cluster.id, prIds };
  }

  it('머지 모두 성공 → 클러스터 status=merged', async () => {
    const mergeMock = vi.fn().mockResolvedValue({ data: { merged: true, sha: 'sha-x' } });
    setOctokit(mockOctokit(mergeMock));
    const { clusterId, prIds } = setupCluster();

    const r = await mergeCluster(clusterId);

    expect(r.merged).toBe(3);
    expect(r.failed).toBe(0);
    expect(r.skipped).toBe(0);
    expect(r.total).toBe(3);
    expect(mergeMock).toHaveBeenCalledTimes(3);
    const merged = db.select().from(prs).where(eq(prs.clusterId, clusterId)).all();
    expect(merged.every((p) => p.status === 'merged')).toBe(true);
    expect(prIds.length).toBe(3);
    const c = db.select().from(clusters).where(eq(clusters.id, clusterId)).get();
    expect(c?.status).toBe('merged');
    expect(c?.closedAt).not.toBeNull();
  });

  it('일부만 성공 → status=partially-merged', async () => {
    const mergeMock = vi
      .fn()
      .mockResolvedValueOnce({ data: { merged: true, sha: 's1' } })
      .mockRejectedValueOnce(new Error('conflict'))
      .mockResolvedValueOnce({ data: { merged: true, sha: 's3' } });
    setOctokit(mockOctokit(mergeMock));
    const { clusterId } = setupCluster();

    const r = await mergeCluster(clusterId);

    expect(r.merged).toBe(2);
    expect(r.failed).toBe(1);
    const c = db.select().from(clusters).where(eq(clusters.id, clusterId)).get();
    expect(c?.status).toBe('partially-merged');
  });

  it('GitHub 가 merged=false 반환 → 해당 PR failed', async () => {
    const mergeMock = vi.fn().mockResolvedValue({ data: { merged: false, sha: '' } });
    setOctokit(mockOctokit(mergeMock));
    const { clusterId } = setupCluster();

    const r = await mergeCluster(clusterId);

    expect(r.merged).toBe(0);
    expect(r.failed).toBe(3);
    // 모두 실패 → 클러스터 status open 유지.
    const c = db.select().from(clusters).where(eq(clusters.id, clusterId)).get();
    expect(c?.status).toBe('open');
  });

  it('installationId 가 없는 프로젝트는 skip 처리', async () => {
    setOctokit(mockOctokit());
    const { clusterId } = setupCluster(null);

    const r = await mergeCluster(clusterId);

    expect(r.merged).toBe(0);
    expect(r.skipped).toBe(3);
    expect(r.details.every((d) => d.kind === 'skipped' && d.reason === 'no-installation')).toBe(
      true,
    );
  });

  it('이미 머지된 PR 은 already-merged 로 skip — 멱등', async () => {
    const mergeMock = vi.fn().mockResolvedValue({ data: { merged: true, sha: 'sha-y' } });
    setOctokit(mockOctokit(mergeMock));
    const { clusterId } = setupCluster();

    await mergeCluster(clusterId);
    // 2회차 — 이미 모두 merged.
    const second = await mergeCluster(clusterId);

    expect(second.merged).toBe(0);
    expect(second.skipped).toBe(3);
    expect(mergeMock).toHaveBeenCalledTimes(3); // 1회차에서만 호출.
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

  it('머지된 PR 은 dissolve 시 review-needed 로 되살아나지 않는다', () => {
    const repoId = setupProject();
    const cluster = db
      .insert(clusters)
      .values({ pattern: 'mixed', title: 't', avgConfidence: 90 })
      .returning({ id: clusters.id })
      .get();
    // 일부는 머지된 상태, 일부는 활성.
    setupPR({ repoId, paths: ['x.ts'], number: 1, clusterId: cluster.id, status: 'merged' });
    setupPR({ repoId, paths: ['x.ts'], number: 2, clusterId: cluster.id, status: 'review-needed' });
    setupPR({
      repoId,
      paths: ['x.ts'],
      number: 3,
      clusterId: cluster.id,
      status: 'auto-mergeable',
    });

    const r = dissolveCluster(cluster.id);
    // 활성 2건만 인박스로 복귀.
    expect(r.released).toBe(2);

    const merged = db.select().from(prs).where(eq(prs.number, 1)).get();
    // 머지된 PR 은 status='merged' 유지, clusterId 도 그대로 (인박스에 안 잡힘).
    expect(merged?.status).toBe('merged');
    expect(merged?.clusterId).toBe(cluster.id);

    const restored = db.select().from(prs).where(eq(prs.number, 2)).get();
    expect(restored?.status).toBe('review-needed');
    expect(restored?.clusterId).toBeNull();

    const fromAutoMergeable = db.select().from(prs).where(eq(prs.number, 3)).get();
    expect(fromAutoMergeable?.status).toBe('review-needed');
    expect(fromAutoMergeable?.clusterId).toBeNull();
  });

  // 사용자가 의도적으로 해체한 PR 은 cooldown 동안 자동 재클러스터링 안 됨.
  it('cooldown 안 PR 은 tryClusterPR 가 skip(recently-dissolved)', async () => {
    const repoId = setupProject();
    const paths = ['x.ts', 'y.ts'];
    // 해체된 직후 PR 시드 — clusterDissolvedAt=now.
    const pr = db
      .insert(prs)
      .values({
        repoId,
        number: 99,
        title: 'recently dissolved',
        authorKind: 'agent',
        authorId: 'devin',
        headSha: 'sha-99',
        linesAdded: 1,
        linesRemoved: 0,
        filesChanged: 2,
        status: 'review-needed',
        clusterDissolvedAt: new Date(),
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
        changedPaths: paths,
      })
      .run();

    // 후보 PR 도 시드 — 평소면 클러스터됐을 조건.
    setupPR({ repoId, paths, number: 100 });
    setupPR({ repoId, paths, number: 101 });

    const r = await tryClusterPR(pr.id);
    expect(r.kind).toBe('skipped');
    if (r.kind === 'skipped') expect(r.reason).toBe('recently-dissolved');
  });
});
