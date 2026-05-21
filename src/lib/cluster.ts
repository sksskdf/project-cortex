import { and, asc, eq, sum } from 'drizzle-orm';
import { db } from '@/db/client';
import { clusters, preReviews, prs, projects, type ClusterRow } from '@/db/schema';
import {
  clusterFixtures,
  clusterIndividualReviewNumber,
  type ClusterDescriptionSegment,
  type ClusterDiffRowFixture,
  type ClusterFixture,
} from '@/fixtures/cluster';
import { derivePattern, deriveIndividualReviewNumber } from '@/lib/cluster-pattern';
import { formatRelativeAge, gaugeTierFromConfidence } from '@/lib/format';
import type { GaugeTier } from '@/lib/types';

export type ClusterPRItem = {
  id: string;
  number: number;
  title: string;
  repo: string;
  score: number;
  scoreTier: GaugeTier;
  similarity: 'identical' | 'different';
  active: boolean;
  // 머지된 PR 인지 — 클러스터 사이드바 카드에 상태 라벨을 노출하기 위함.
  // 인박스에선 머지된 PR 이 안 보이는데 클러스터에선 보여서 생기는 일관성 부족 보완.
  status: 'open' | 'review-needed' | 'auto-mergeable' | 'merged' | 'closed';
};

export type ClusterDetailView = {
  id: string;
  title: string;
  // 클러스터 상태 — UI 의 머지/해제 버튼 disable 분기에 사용.
  status: ClusterRow['status'];
  descriptionSegments: ReadonlyArray<ClusterDescriptionSegment>;
  detectedAgo: string;
  author: string;
  repo: string;
  prs: ReadonlyArray<ClusterPRItem>;
  summary: {
    avgScore: number;
    totalAdditions: number;
    filesChanged: number;
  };
  pattern: {
    sourceLabel: string;
    lines: ReadonlyArray<import('@/lib/types').CodeLine>;
  };
  diffs: ReadonlyArray<ClusterDiffRowFixture>;
  individualReviewNumber: number;
  decisionNote: { highlight: string; rest: string };
};

function parseClusterId(viewId: string): number | null {
  const match = viewId.match(/^cluster-(\d+)$/);
  if (!match) return null;
  return Number(match[1]);
}

function mostCommon<T>(items: ReadonlyArray<T>): T | null {
  if (items.length === 0) return null;
  const counts = new Map<T, number>();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  let best: T = items[0];
  let bestCount = 0;
  for (const [value, n] of counts) {
    if (n > bestCount) {
      best = value;
      bestCount = n;
    }
  }
  return best;
}

export async function getClusterDetail(viewId: string): Promise<ClusterDetailView | null> {
  const dbId = parseClusterId(viewId);
  if (dbId === null) return null;

  const cluster = db.select().from(clusters).where(eq(clusters.id, dbId)).get();
  if (!cluster) return null;

  const prRows = db
    .select({
      pr: prs,
      preReview: preReviews,
      repoSlug: projects.slug,
    })
    .from(prs)
    .innerJoin(projects, eq(prs.repoId, projects.id))
    // 최신 SHA 의 preReview 1건만 — 과거 SHA 의 행들로 PR 이 중복되지 않게.
    .leftJoin(preReviews, and(eq(preReviews.prId, prs.id), eq(preReviews.headSha, prs.headSha)))
    .where(eq(prs.clusterId, dbId))
    .orderBy(asc(prs.number))
    .all();

  // fixture 가 있는 패턴(시드의 i18n-labels)은 fixture 우선.
  // 없으면 PR · preReview 행에서 derive (Phase 6.3).
  const seedFixture: ClusterFixture | null = clusterFixtures[cluster.pattern] ?? null;
  const derivedFixture: ClusterFixture | null = seedFixture
    ? null
    : derivePattern(prRows.map((r) => ({ pr: r.pr, preReview: r.preReview })));
  const fixture = seedFixture ?? derivedFixture;
  if (!fixture) return null;

  const totals = db
    .select({ added: sum(prs.linesAdded), files: sum(prs.filesChanged) })
    .from(prs)
    .where(eq(prs.clusterId, dbId))
    .get();

  const individualNumber =
    clusterIndividualReviewNumber[cluster.pattern] ??
    deriveIndividualReviewNumber(prRows.map((r) => ({ pr: r.pr, preReview: r.preReview })));
  const firstPrNumber = prRows.length > 0 ? prRows[0].pr.number : null;
  const items: ClusterPRItem[] = prRows.map((row) => {
    const confidence = row.preReview?.confidence ?? 0;
    const isDifferent = row.pr.number === individualNumber;
    return {
      id: `pr-${row.pr.id}`,
      number: row.pr.number,
      title: row.pr.title,
      repo: row.repoSlug,
      score: confidence,
      scoreTier: gaugeTierFromConfidence(confidence),
      similarity: isDifferent ? 'different' : 'identical',
      active: row.pr.number === firstPrNumber,
      status: row.pr.status,
    };
  });

  const createdAtMs =
    cluster.createdAt instanceof Date
      ? cluster.createdAt.getTime()
      : Number(cluster.createdAt) * 1000;

  return {
    id: viewId,
    title: cluster.title,
    status: cluster.status,
    descriptionSegments: fixture.descriptionSegments,
    detectedAgo: formatRelativeAge(createdAtMs),
    author: mostCommon(prRows.map((r) => r.pr.authorId)) ?? '',
    repo: mostCommon(prRows.map((r) => r.repoSlug)) ?? '',
    prs: items,
    summary: {
      avgScore: cluster.avgConfidence,
      totalAdditions: Number(totals?.added ?? 0),
      filesChanged: Number(totals?.files ?? 0),
    },
    pattern: {
      sourceLabel: fixture.patternSourceLabel,
      lines: fixture.patternLines,
    },
    diffs: fixture.diffs,
    individualReviewNumber: individualNumber,
    decisionNote: fixture.decisionNote,
  };
}
