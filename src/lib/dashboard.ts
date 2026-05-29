import { and, avg, count, desc, eq, gte, inArray, isNull, lt } from 'drizzle-orm';
import { db } from '@/db/client';
import { agentRuns, clusters, preReviews, prs, projects, triageDecisions } from '@/db/schema';
import { clusterNotes } from '@/fixtures/dashboard';
import { flagsToTags, formatRelativeAge, gaugeTierFromConfidence, reasonTone } from '@/lib/format';
import { deriveRowActions } from '@/lib/inbox';
import { orderInbox } from '@/lib/queue';
import type { PR, ReasonTone, StatDelta } from '@/lib/types';

export type DashboardStats = {
  pendingReview: { value: number; delta: StatDelta };
  autoMergedThisWeek: { value: number; delta: StatDelta };
  // 사용자가 Cortex UI 에서 직접 누른 머지 (attemptHumanMerge — decidedBy='human').
  // autoMergedThisWeek 의 자동 카운트와 별개로 사람 활동 측정.
  humanMergedThisWeek: { value: number; delta: StatDelta };
  agentsRunning: { value: number };
  avgConfidence: { value: number; delta: StatDelta };
};

// 머지 종류 구분:
// - 'auto'   : Cortex 가 자동 머지 (triage decision=auto-merge + decidedBy=system)
// - 'human'  : 사용자가 Cortex UI 에서 직접 머지 (attemptHumanMerge — decidedBy=human)
// - 'github' : Cortex 밖에서 머지된 PR (triage decision 없음, GitHub UI 직접 머지 등)
export type MergeKind = 'auto' | 'human' | 'github';

export type ActivityFeedItem = {
  id: string;
  // PR 상세 라우트 viewId — 사용자 시그널 (2026-05-22): "최근 머지 clickable 하게 해서
  // PR 로 이동". '/pr/${href}'.
  href: string;
  agent: string;
  title: string;
  score: number;
  ageText: string;
  repo: string;
  // GitHub PR 번호 — 최근 머지 행에 #N 노출 (PRRow 와 동일 패턴).
  number: number;
  kind: MergeKind;
  // Phase 20 — 사용자가 확인했는지 (readAt !== null). 최근 머지에서 미확인 점으로 표시.
  read: boolean;
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

  // 뮤트된 프로젝트의 PR 은 '검토 대기' stat 및 delta 에서 제외 — 인박스/대시보드 표면 일관성.
  const pending = db
    .select({ n: count() })
    .from(prs)
    .innerJoin(projects, eq(prs.repoId, projects.id))
    .where(and(eq(prs.status, 'review-needed'), isNull(prs.clusterId), eq(projects.muted, false)))
    .get();

  // pendingReview delta — 이번 7일 신규 review-needed vs 지난 7일 (뮤트 제외).
  const pendingThisWeek = db
    .select({ n: count() })
    .from(prs)
    .innerJoin(projects, eq(prs.repoId, projects.id))
    .where(
      and(eq(prs.status, 'review-needed'), gte(prs.createdAt, weekAgo), eq(projects.muted, false)),
    )
    .get();
  const pendingLastWeek = db
    .select({ n: count() })
    .from(prs)
    .innerJoin(projects, eq(prs.repoId, projects.id))
    .where(
      and(
        eq(prs.status, 'review-needed'),
        gte(prs.createdAt, twoWeeksAgo),
        lt(prs.createdAt, weekAgo),
        eq(projects.muted, false),
      ),
    )
    .get();

  // autoMergedThisWeek — 이번 7일에 Cortex 가 *시스템 자동* 으로 머지한 PR.
  // 룰: status='merged' + triage_decisions.decision='auto-merge' + decidedBy='system'.
  // 사람이 Cortex UI 에서 직접 누른 머지 (attemptHumanMerge) 는 decidedBy='human' 이라
  // 자동 카운트 제외. GitHub UI 에서 직접 머지한 PR 은 triage decision 자체가 없어 자동 제외.
  const mergedThisWeek = db
    .select({ n: count() })
    .from(prs)
    .innerJoin(triageDecisions, eq(triageDecisions.prId, prs.id))
    .where(
      and(
        eq(prs.status, 'merged'),
        gte(prs.updatedAt, weekAgo),
        eq(triageDecisions.decision, 'auto-merge'),
        eq(triageDecisions.decidedBy, 'system'),
      ),
    )
    .get();
  const mergedLastWeek = db
    .select({ n: count() })
    .from(prs)
    .innerJoin(triageDecisions, eq(triageDecisions.prId, prs.id))
    .where(
      and(
        eq(prs.status, 'merged'),
        gte(prs.updatedAt, twoWeeksAgo),
        lt(prs.updatedAt, weekAgo),
        eq(triageDecisions.decision, 'auto-merge'),
        eq(triageDecisions.decidedBy, 'system'),
      ),
    )
    .get();

  // humanMergedThisWeek — 사용자가 Cortex UI 에서 직접 머지 (decidedBy='human').
  const humanThisWeek = db
    .select({ n: count() })
    .from(prs)
    .innerJoin(triageDecisions, eq(triageDecisions.prId, prs.id))
    .where(
      and(
        eq(prs.status, 'merged'),
        gte(prs.updatedAt, weekAgo),
        eq(triageDecisions.decidedBy, 'human'),
      ),
    )
    .get();
  const humanLastWeek = db
    .select({ n: count() })
    .from(prs)
    .innerJoin(triageDecisions, eq(triageDecisions.prId, prs.id))
    .where(
      and(
        eq(prs.status, 'merged'),
        gte(prs.updatedAt, twoWeeksAgo),
        lt(prs.updatedAt, weekAgo),
        eq(triageDecisions.decidedBy, 'human'),
      ),
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
    humanMergedThisWeek: {
      value: humanThisWeek?.n ?? 0,
      delta: diffToDelta(humanThisWeek?.n ?? 0, humanLastWeek?.n ?? 0),
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
      installationId: projects.installationId,
    })
    .from(prs)
    .innerJoin(projects, eq(prs.repoId, projects.id))
    // 최신 SHA 의 preReview 1건만 — 과거 SHA 의 행들로 PR 이 중복되지 않게.
    .leftJoin(preReviews, and(eq(preReviews.prId, prs.id), eq(preReviews.headSha, prs.headSha)))
    .leftJoin(triageDecisions, eq(triageDecisions.prId, prs.id))
    // 뮤트된 프로젝트의 PR 은 대시보드 '지금 처리할 것' 위젯에서 제외 — 인박스 룰과 동일.
    .where(and(eq(prs.status, 'review-needed'), isNull(prs.clusterId), eq(projects.muted, false)))
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
      actions: deriveRowActions(row.pr.status, row.installationId, row.pr.testsPassed),
    };
  });

  // 우선순위 정렬 후 상위 limit개 — 인박스와 같은 룰 유지.
  return orderInbox(items).slice(0, limit);
}

export async function getRecentMerges(limit = 5): Promise<ActivityFeedItem[]> {
  // 모든 머지 (자동·사람·외부) — 화면에서 kind 별로 라벨 분리.
  // 자동 카운트 (autoMergedThisWeek) 와 다르게 여기서는 머지 활동 자체를 보여줌.
  const rows = db
    .select({
      pr: prs,
      preReview: preReviews,
      triage: triageDecisions,
      repoSlug: projects.slug,
    })
    .from(prs)
    .innerJoin(projects, eq(prs.repoId, projects.id))
    // 최신 SHA 의 preReview 1건만 — 과거 SHA 의 행들로 PR 이 중복되지 않게.
    .leftJoin(preReviews, and(eq(preReviews.prId, prs.id), eq(preReviews.headSha, prs.headSha)))
    .leftJoin(triageDecisions, eq(triageDecisions.prId, prs.id))
    .where(eq(prs.status, 'merged'))
    .orderBy(desc(prs.updatedAt))
    .limit(limit)
    .all();

  return rows.map((row) => {
    const updatedMs =
      row.pr.updatedAt instanceof Date
        ? row.pr.updatedAt.getTime()
        : Number(row.pr.updatedAt) * 1000;
    const kind: MergeKind = !row.triage
      ? 'github'
      : row.triage.decision === 'auto-merge' && row.triage.decidedBy === 'system'
        ? 'auto'
        : 'human';
    return {
      id: `merged-${row.pr.id}`,
      href: `pr-${row.pr.id}`,
      agent: row.pr.authorId,
      title: row.pr.title,
      score: row.preReview?.confidence ?? 0,
      ageText: formatRelativeAge(updatedMs),
      repo: row.repoSlug,
      number: row.pr.number,
      kind,
      read: row.pr.readAt !== null,
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
