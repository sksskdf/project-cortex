import { and, avg, count, desc, eq, gte, inArray, isNull, lt } from 'drizzle-orm';
import { db } from '@/db/client';
import { agentRuns, clusters, preReviews, prs, projects, triageDecisions } from '@/db/schema';
import { clusterNotes } from '@/fixtures/dashboard';
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

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ONE_WEEK_MS = 7 * ONE_DAY_MS;
const COMPARED_TO_LAST_WEEK = '지난 주 대비';

// 두 정수 비교 → StatDelta 형태. 음수면 down, 0 이면 flat, 양수면 up.
function diffToDelta(current: number, previous: number): StatDelta {
  const amount = current - previous;
  const direction: StatDelta['direction'] = amount > 0 ? 'up' : amount < 0 ? 'down' : 'flat';
  return { amount: Math.abs(amount), direction, comparedTo: COMPARED_TO_LAST_WEEK };
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const now = Date.now();
  const weekAgo = new Date(now - ONE_WEEK_MS);
  const twoWeeksAgo = new Date(now - 2 * ONE_WEEK_MS);

  const pending = db
    .select({ n: count() })
    .from(prs)
    .where(and(eq(prs.status, 'review-needed'), isNull(prs.clusterId)))
    .get();

  // pendingReview delta — 이번 7일 신규 review-needed vs 지난 7일.
  const pendingThisWeek = db
    .select({ n: count() })
    .from(prs)
    .where(and(eq(prs.status, 'review-needed'), gte(prs.createdAt, weekAgo)))
    .get();
  const pendingLastWeek = db
    .select({ n: count() })
    .from(prs)
    .where(
      and(
        eq(prs.status, 'review-needed'),
        gte(prs.createdAt, twoWeeksAgo),
        lt(prs.createdAt, weekAgo),
      ),
    )
    .get();

  // autoMergedThisWeek — 이번 7일 merged 행. delta 는 이번 vs 지난 7일.
  const mergedThisWeek = db
    .select({ n: count() })
    .from(prs)
    .where(and(eq(prs.status, 'merged'), gte(prs.updatedAt, weekAgo)))
    .get();
  const mergedLastWeek = db
    .select({ n: count() })
    .from(prs)
    .where(
      and(eq(prs.status, 'merged'), gte(prs.updatedAt, twoWeeksAgo), lt(prs.updatedAt, weekAgo)),
    )
    .get();

  // avgConfidence — 분석된 모든 PR 의 평균 (기존). delta 는 이번 7일 vs 지난 7일 분석분.
  const avgConfAll = db
    .select({ a: avg(preReviews.confidence) })
    .from(preReviews)
    .get();
  const avgConfThisWeek = db
    .select({ a: avg(preReviews.confidence) })
    .from(preReviews)
    .where(gte(preReviews.analyzedAt, weekAgo))
    .get();
  const avgConfLastWeek = db
    .select({ a: avg(preReviews.confidence) })
    .from(preReviews)
    .where(and(gte(preReviews.analyzedAt, twoWeeksAgo), lt(preReviews.analyzedAt, weekAgo)))
    .get();

  // 진행 중 에이전트 = agent_runs.status in ('queued', 'running').
  // 실데이터 흐름이 아직 없으면 0 — Phase 8 에서 onboarding 이슈 + 에이전트 실행이 들어오면 자연스럽게 채워짐.
  const agentsRunning = db
    .select({ n: count() })
    .from(agentRuns)
    .where(inArray(agentRuns.status, ['queued', 'running']))
    .get();

  return {
    pendingReview: {
      value: pending?.n ?? 0,
      delta: diffToDelta(pendingThisWeek?.n ?? 0, pendingLastWeek?.n ?? 0),
    },
    autoMergedThisWeek: {
      value: mergedThisWeek?.n ?? 0,
      delta: diffToDelta(mergedThisWeek?.n ?? 0, mergedLastWeek?.n ?? 0),
    },
    agentsRunning: { value: agentsRunning?.n ?? 0 },
    avgConfidence: {
      value: Math.round(Number(avgConfAll?.a ?? 0)),
      delta: diffToDelta(
        Math.round(Number(avgConfThisWeek?.a ?? 0)),
        Math.round(Number(avgConfLastWeek?.a ?? 0)),
      ),
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
