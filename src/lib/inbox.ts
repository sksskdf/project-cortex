import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { db } from '@/db/client';
import { clusters, preReviews, prs, projects, triageDecisions } from '@/db/schema';
import { flagsToTags, formatRelativeAge, gaugeTierFromConfidence, reasonTone } from '@/lib/format';
import { orderInbox } from '@/lib/queue';
import type { PR, ReasonTone, SidebarCounts } from '@/lib/types';

export type InboxCategoryId = 'all' | 'flagged' | 'large' | 'migration' | 'cluster' | 'mentioned';

export type InboxCategory = {
  id: InboxCategoryId;
  count: number;
};

export type InboxProject = {
  id: string;
  name: string;
  count: number;
  dot: 'blue' | 'green' | 'yellow';
};

export type InboxClusterBanner = {
  id: string;
  title: string;
  description: string;
};

const PROJECT_DOT: Record<string, InboxProject['dot']> = {
  'cortex-web': 'blue',
  'payments-api': 'green',
  'data-pipeline': 'yellow',
};

export async function getSidebarCounts(): Promise<SidebarCounts> {
  const inboxCount = db
    .select({ n: count() })
    .from(prs)
    .where(and(eq(prs.status, 'review-needed'), isNull(prs.clusterId)))
    .get();

  const projectsCount = db.select({ n: count() }).from(projects).get();
  const clustersCount = db
    .select({ n: count() })
    .from(clusters)
    .where(eq(clusters.status, 'open'))
    .get();

  // 에이전트 카운트 — agent_runs 없이 활성 PR의 distinct authorKind='agent' authorId로 근사.
  const agents = db
    .selectDistinct({ id: prs.authorId })
    .from(prs)
    .where(eq(prs.authorKind, 'agent'))
    .all();

  return {
    inbox: inboxCount?.n ?? 0,
    projects: projectsCount?.n ?? 0,
    agents: agents.length,
    clusters: clustersCount?.n ?? 0,
  };
}

export async function listInboxQueue(): Promise<PR[]> {
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
      reason: {
        text: row.triage?.reason ?? row.preReview?.summary ?? '',
        tone,
      },
      additions: row.pr.linesAdded,
      deletions: row.pr.linesRemoved,
      fileCount: row.pr.filesChanged,
      ageText: formatRelativeAge(createdAtMs),
      gauge: {
        value: confidence,
        tier: gaugeTierFromConfidence(confidence),
      },
    };
  });

  // 우선순위 정렬: tone (alert > warn > info) > gauge 낮은 순 > age 오래된 순.
  return [...orderInbox(items)];
}

export async function getInboxCategories(): Promise<InboxCategory[]> {
  const queue = await listInboxQueue();
  const total = queue.length;
  const flagged = queue.filter((p) => p.reason.tone === 'alert').length;
  const large = queue.filter((p) => p.tags.some((tag) => tag.label === '큰 변경')).length;
  const migration = queue.filter((p) => p.tags.some((tag) => tag.label === '마이그레이션')).length;

  const clusterPrs = db
    .select({ n: count() })
    .from(prs)
    .innerJoin(triageDecisions, eq(triageDecisions.prId, prs.id))
    .where(eq(triageDecisions.decision, 'cluster'))
    .get();

  return [
    { id: 'all', count: total },
    { id: 'flagged', count: flagged },
    { id: 'large', count: large },
    { id: 'migration', count: migration },
    { id: 'cluster', count: clusterPrs?.n ?? 0 },
    { id: 'mentioned', count: 0 },
  ];
}

export async function getInboxProjects(): Promise<InboxProject[]> {
  const rows = db
    .select({
      slug: projects.slug,
      name: projects.name,
      n: count(prs.id),
    })
    .from(projects)
    .leftJoin(prs, eq(prs.repoId, projects.id))
    .groupBy(projects.id, projects.slug, projects.name)
    .orderBy(desc(count(prs.id)))
    .all();

  return rows
    .filter((r) => r.n > 0)
    .map((r) => ({
      id: r.slug,
      name: r.slug,
      count: r.n,
      dot: PROJECT_DOT[r.slug] ?? 'blue',
    }));
}

export async function getInboxClusterBanner(): Promise<InboxClusterBanner | null> {
  const cluster = db
    .select()
    .from(clusters)
    .where(eq(clusters.status, 'open'))
    .orderBy(desc(clusters.createdAt))
    .get();

  if (!cluster) return null;

  const prCount = db.select({ n: count() }).from(prs).where(eq(prs.clusterId, cluster.id)).get();

  const total = prCount?.n ?? 0;

  return {
    id: `cluster-${cluster.id}`,
    title: `${cluster.title} — ${total}건이 묶였어요`,
    description: `평균 신뢰 ${cluster.avgConfidence} · 한 번의 결정으로 ${total}개 PR을 처리할 수 있습니다`,
  };
}
