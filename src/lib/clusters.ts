import { count, desc, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { clusters, prs, projects, type ClusterRow } from '@/db/schema';
import { formatRelativeAge } from './format';

// /clusters 목록 화면용 — 모든 status 의 클러스터를 한 번에 조회.
// 대시보드의 getDashboardClusters 는 status='open' + clusterNotes fixture 매핑을 쓰지만,
// 본 함수는 닫힌 (merged/dissolved) 도 포함하고 데이터를 derive 만 사용.

export type ClusterListGroup = 'active' | 'closed';

export type ClusterListItem = {
  id: string;
  title: string;
  status: ClusterRow['status'];
  group: ClusterListGroup;
  prCount: number;
  avgScore: number;
  repo: string;
  author: string;
  detectedAgo: string;
  // closed 그룹은 닫힌 시점, active 그룹은 detectedAgo 와 동일.
  closedAgo: string | null;
};

function classifyGroup(status: ClusterRow['status']): ClusterListGroup {
  return status === 'open' || status === 'partially-merged' ? 'active' : 'closed';
}

function asMs(value: Date | number | null): number | null {
  if (value === null) return null;
  return value instanceof Date ? value.getTime() : Number(value) * 1000;
}

// 클러스터당 1 row + 멤버 PR 의 첫 작성자/레포를 함께 가져온다. 멤버가 0건이면
// (dissolveCluster 직후 등) author/repo 가 빈 문자열로 폴백.
export async function listAllClusters(): Promise<ClusterListItem[]> {
  const rows = db
    .select({ cluster: clusters, n: count(prs.id) })
    .from(clusters)
    .leftJoin(prs, eq(prs.clusterId, clusters.id))
    .groupBy(clusters.id)
    .orderBy(desc(clusters.createdAt))
    .all();

  return rows.map((r): ClusterListItem => {
    // 대표 작성자·레포는 첫 멤버 PR 기준. 클러스터 정의상 같은 작성자·같은 레포라 안전.
    const sample = db
      .select({ authorId: prs.authorId, slug: projects.slug })
      .from(prs)
      .innerJoin(projects, eq(prs.repoId, projects.id))
      .where(eq(prs.clusterId, r.cluster.id))
      .get();

    const createdMs = asMs(r.cluster.createdAt) ?? Date.now();
    const closedMs = asMs(r.cluster.closedAt);

    return {
      id: `cluster-${r.cluster.id}`,
      title: r.cluster.title,
      status: r.cluster.status,
      group: classifyGroup(r.cluster.status),
      prCount: r.n,
      avgScore: r.cluster.avgConfidence,
      repo: sample?.slug ?? '',
      author: sample?.authorId ?? '',
      detectedAgo: formatRelativeAge(createdMs),
      closedAgo: closedMs !== null ? formatRelativeAge(closedMs) : null,
    };
  });
}
