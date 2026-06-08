// 검수 P2-9: 자동 클러스터링(tryClusterPR · jaccardSimilarity · 임계값 상수) 삭제 후 잔존
// 테스트는 수동 관리 흐름만 — dissolveCluster + mergeCluster.

import type { Octokit } from '@octokit/rest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { db } from '@/db/client';
import { clusters, notifications, preReviews, prs, projects } from '@/db/schema';
import { dissolveCluster, mergeCluster } from './clustering';
import { setOctokit } from './github';

beforeAll(() => {
  migrate(db, { migrationsFolder: 'src/db/migrations' });
});

beforeEach(() => {
  db.delete(notifications).run();
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
});
