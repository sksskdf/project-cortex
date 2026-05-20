import { and, avg, count, desc, eq, gte, inArray, isNull } from 'drizzle-orm';
import { db } from '@/db/client';
import { agentRuns, clusters, preReviews, prs, projects, triageDecisions } from '@/db/schema';
import { clusterNotes, statDeltas } from '@/fixtures/dashboard';
import { flagsToTags, formatRelativeAge, gaugeTierFromConfidence, reasonTone } from '@/lib/format';
import { orderInbox } from '@/lib/queue';
import type { PR, ReasonTone, StatDelta } from '@/lib/types';

export type DashboardStats = {
  pendingReview: { value: number; delta: StatDelta };
  autoMergedThisWeek: { value: number; delta: StatDelta };
  agentsRunning: { value: number };
  avgConfidence: { value: number; delta: StatDelta };
};

export type ActivityFeedItem = {
  id: string;
  agent: string;
  title: string;
  score: number;
  ageText: string;
  repo: string;
};

export type DashboardClusterSummary = {
  id: string;
  title: string;
  count: number;
  avgScore: number;
  note: string;
};

const WEEK_AGO_SEC = () => Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000);

export async function getDashboardStats(): Promise<DashboardStats> {
  const pending = db
    .select({ n: count() })
    .from(prs)
    .where(and(eq(prs.status, 'review-needed'), isNull(prs.clusterId)))
    .get();

  const mergedRecent = db
    .select({ n: count() })
    .from(prs)
    .where(and(eq(prs.status, 'merged'), gte(prs.updatedAt, new Date(WEEK_AGO_SEC() * 1000))))
    .get();

  const avgConf = db
    .select({ a: avg(preReviews.confidence) })
    .from(preReviews)
    .get();

  // 진행 중 에이전트 = agent_runs.status in ('queued', 'running').
  // 실데이터 흐름이 아직 없으면 0 — Phase 8 에서 onboarding 이슈 + 에이전트 실행이 들어오면 자연스럽게 채워짐.
  const agentsRunning = db
    .select({ n: count() })
    .from(agentRuns)
    .where(inArray(agentRuns.status, ['queued', 'running']))
    .get();

  return {
    pendingReview: { value: pending?.n ?? 0, delta: statDeltas.pendingReview },
    autoMergedThisWeek: { value: mergedRecent?.n ?? 0, delta: statDeltas.autoMerged },
    agentsRunning: { value: agentsRunning?.n ?? 0 },
    avgConfidence: {
      value: Math.round(Number(avgConf?.a ?? 0)),
      delta: statDeltas.avgConfidence,
    },
  };
}

export async function getTodayRows(limit = 3): Promise<PR[]> {
  const rows = db
    .select({
      pr: prs,
      preReview: preReviews,
      triage: triageDecisions,
      repoSlug: projects.slug,
    })
    .from(prs)
    .innerJoin(projects, eq(prs.repoId, projects.id))
    .leftJoin(preReviews, eq(preReviews.prId, prs.id))
    .leftJoin(triageDecisions, eq(triageDecisions.prId, prs.id))
    .where(and(eq(prs.status, 'review-needed'), isNull(prs.clusterId)))
    .all();

  const items: PR[] = rows.map((row) => {
    const confidence = row.preReview?.confidence ?? 0;
    const flags = row.preReview?.flags ?? [];
    const tone: ReasonTone = row.triage ? reasonTone(confidence, flags) : 'info';
    const createdAtMs =
      row.pr.createdAt instanceof Date
        ? row.pr.createdAt.getTime()
        : Number(row.pr.createdAt) * 1000;

    return {
      id: `pr-${row.pr.id}`,
      title: row.pr.title,
      repo: row.repoSlug,
      number: row.pr.number,
      author: { name: row.pr.authorId, kind: row.pr.authorKind },
      tags: flagsToTags(flags),
      reason: { text: row.triage?.reason ?? '', tone },
      additions: row.pr.linesAdded,
      deletions: row.pr.linesRemoved,
      fileCount: row.pr.filesChanged,
      ageText: formatRelativeAge(createdAtMs),
      gauge: { value: confidence, tier: gaugeTierFromConfidence(confidence) },
    };
  });

  // 우선순위 정렬 후 상위 limit개 — 인박스와 같은 룰 유지.
  return orderInbox(items).slice(0, limit);
}

export async function getRecentAutoMerges(limit = 5): Promise<ActivityFeedItem[]> {
  const rows = db
    .select({
      pr: prs,
      preReview: preReviews,
      repoSlug: projects.slug,
    })
    .from(prs)
    .innerJoin(projects, eq(prs.repoId, projects.id))
    .leftJoin(preReviews, eq(preReviews.prId, prs.id))
    .where(eq(prs.status, 'merged'))
    .orderBy(desc(prs.updatedAt))
    .limit(limit)
    .all();

  return rows.map((row) => {
    const updatedMs =
      row.pr.updatedAt instanceof Date
        ? row.pr.updatedAt.getTime()
        : Number(row.pr.updatedAt) * 1000;
    return {
      id: `merged-${row.pr.id}`,
      agent: row.pr.authorId,
      title: row.pr.title,
      score: row.preReview?.confidence ?? 0,
      ageText: formatRelativeAge(updatedMs),
      repo: row.repoSlug,
    };
  });
}

export async function getDashboardClusters(): Promise<DashboardClusterSummary[]> {
  const rows = db
    .select({ cluster: clusters, n: count(prs.id) })
    .from(clusters)
    .leftJoin(prs, eq(prs.clusterId, clusters.id))
    .where(eq(clusters.status, 'open'))
    .groupBy(clusters.id)
    .orderBy(desc(clusters.createdAt))
    .all();

  return rows.map((r) => ({
    id: `cluster-${r.cluster.id}`,
    title: r.cluster.title,
    count: r.n,
    avgScore: r.cluster.avgConfidence,
    note: clusterNotes[r.cluster.pattern] ?? `평균 신뢰 ${r.cluster.avgConfidence}`,
  }));
}
