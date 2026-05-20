import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/client';
import { clusters, prs, projects } from '@/db/schema';
import { listAllClusters } from './clusters';

beforeAll(() => {
  migrate(db, { migrationsFolder: 'src/db/migrations' });
});

beforeEach(() => {
  db.delete(prs).run();
  db.delete(clusters).run();
  db.delete(projects).run();
});

function setupProject(slug = 'acme/web'): number {
  return db.insert(projects).values({ slug, name: slug }).returning({ id: projects.id }).get().id;
}

function setupCluster(opts: {
  pattern: string;
  title?: string;
  status?: 'open' | 'partially-merged' | 'merged' | 'dissolved';
  avgConfidence?: number;
  closedAt?: Date | null;
  createdAt?: Date;
}): number {
  return db
    .insert(clusters)
    .values({
      pattern: opts.pattern,
      title: opts.title ?? opts.pattern,
      avgConfidence: opts.avgConfidence ?? 90,
      status: opts.status ?? 'open',
      closedAt: opts.closedAt ?? null,
      createdAt: opts.createdAt ?? new Date(),
    })
    .returning({ id: clusters.id })
    .get().id;
}

function setupPR(opts: {
  repoId: number;
  clusterId: number;
  number: number;
  authorId?: string;
}): void {
  db.insert(prs)
    .values({
      repoId: opts.repoId,
      number: opts.number,
      title: `PR ${opts.number}`,
      authorKind: 'agent',
      authorId: opts.authorId ?? 'devin',
      headSha: `sha-${opts.number}`,
      linesAdded: 5,
      linesRemoved: 0,
      filesChanged: 1,
      status: 'review-needed',
      clusterId: opts.clusterId,
    })
    .run();
}

describe('listAllClusters', () => {
  it('빈 DB 면 빈 배열', async () => {
    const r = await listAllClusters();
    expect(r).toEqual([]);
  });

  it('status 별로 group 분류 — open/partially-merged = active, merged/dissolved = closed', async () => {
    setupCluster({ pattern: 'p1', status: 'open' });
    setupCluster({ pattern: 'p2', status: 'partially-merged' });
    setupCluster({ pattern: 'p3', status: 'merged' });
    setupCluster({ pattern: 'p4', status: 'dissolved' });

    const r = await listAllClusters();
    const byPattern = new Map(r.map((c) => [c.title, c]));
    expect(byPattern.get('p1')?.group).toBe('active');
    expect(byPattern.get('p2')?.group).toBe('active');
    expect(byPattern.get('p3')?.group).toBe('closed');
    expect(byPattern.get('p4')?.group).toBe('closed');
  });

  it('각 클러스터의 PR 수 · 작성자 · 레포 집계', async () => {
    const repoId = setupProject('acme/web');
    const clusterId = setupCluster({ pattern: 'i18n', title: 'i18n 패턴' });
    setupPR({ repoId, clusterId, number: 1, authorId: 'devin' });
    setupPR({ repoId, clusterId, number: 2, authorId: 'devin' });
    setupPR({ repoId, clusterId, number: 3, authorId: 'devin' });

    const r = await listAllClusters();
    expect(r).toHaveLength(1);
    expect(r[0].prCount).toBe(3);
    expect(r[0].author).toBe('devin');
    expect(r[0].repo).toBe('acme/web');
  });

  it('createdAt 내림차순 정렬 (최신 먼저)', async () => {
    setupCluster({ pattern: 'old', createdAt: new Date('2026-05-01T00:00:00Z') });
    setupCluster({ pattern: 'new', createdAt: new Date('2026-05-20T00:00:00Z') });
    setupCluster({ pattern: 'mid', createdAt: new Date('2026-05-10T00:00:00Z') });

    const r = await listAllClusters();
    expect(r.map((c) => c.title)).toEqual(['new', 'mid', 'old']);
  });

  it('멤버 PR 0건 클러스터(dissolved) — author/repo 빈 문자열', async () => {
    setupCluster({ pattern: 'empty', status: 'dissolved', closedAt: new Date() });

    const r = await listAllClusters();
    expect(r).toHaveLength(1);
    expect(r[0].prCount).toBe(0);
    expect(r[0].author).toBe('');
    expect(r[0].repo).toBe('');
    expect(r[0].closedAgo).not.toBeNull();
  });

  it('closedAt 없는 활성 클러스터는 closedAgo=null', async () => {
    setupCluster({ pattern: 'live', status: 'open' });
    const r = await listAllClusters();
    expect(r[0].closedAgo).toBeNull();
  });
});
