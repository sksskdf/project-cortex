// Phase 7 — /reports 페이지에 노출되는 운영 메트릭 집계.
// 모든 함수는 동기 (DB query 만). 차트는 page.tsx 에서 SVG 로 렌더.

import { and, desc, eq, gte, like, lt, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { preReviews, prs, projects, triageDecisions } from '@/db/schema';
import type { MergeKind } from './dashboard';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ONE_WEEK_MS = 7 * ONE_DAY_MS;

// 한 주 자동/수동/외부 머지 카운트 + 자동 머지율. 자동 머지율 = auto / (auto+human+github).
export type MergeRateSummary = {
  windowDays: number;
  autoCount: number;
  humanCount: number;
  githubCount: number;
  totalMerged: number;
  autoMergeRate: number; // 0-100 정수 %
};

export function getMergeRateSummary(windowDays: number = 7): MergeRateSummary {
  const since = new Date(Date.now() - windowDays * ONE_DAY_MS);

  // auto + human 은 triage_decisions 로 구분. github 직접 머지는 triage decision 자체가 없음.
  const autoRow = db
    .select({ n: sql<number>`count(*)` })
    .from(prs)
    .innerJoin(triageDecisions, eq(triageDecisions.prId, prs.id))
    .where(
      and(
        eq(prs.status, 'merged'),
        gte(prs.updatedAt, since),
        eq(triageDecisions.decision, 'auto-merge'),
        eq(triageDecisions.decidedBy, 'system'),
      ),
    )
    .get();

  const humanRow = db
    .select({ n: sql<number>`count(*)` })
    .from(prs)
    .innerJoin(triageDecisions, eq(triageDecisions.prId, prs.id))
    .where(
      and(
        eq(prs.status, 'merged'),
        gte(prs.updatedAt, since),
        eq(triageDecisions.decidedBy, 'human'),
      ),
    )
    .get();

  // 전체 머지 PR 수 - triage decision 있는 머지 = github 직접 머지 수.
  const totalMergedRow = db
    .select({ n: sql<number>`count(*)` })
    .from(prs)
    .where(and(eq(prs.status, 'merged'), gte(prs.updatedAt, since)))
    .get();

  const autoCount = autoRow?.n ?? 0;
  const humanCount = humanRow?.n ?? 0;
  const totalMerged = totalMergedRow?.n ?? 0;
  const githubCount = Math.max(0, totalMerged - autoCount - humanCount);
  const autoMergeRate = totalMerged > 0 ? Math.round((autoCount / totalMerged) * 100) : 0;

  return {
    windowDays,
    autoCount,
    humanCount,
    githubCount,
    totalMerged,
    autoMergeRate,
  };
}

// 일별 PR 인입량 — 새 PR 의 createdAt 기준으로 days 일 동안 day 단위 bucket.
export type DailyCount = { date: string; count: number };

function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function getDailyIncomingPRs(days: number = 7): DailyCount[] {
  const since = new Date(Date.now() - days * ONE_DAY_MS);
  const rows = db
    .select({ createdAt: prs.createdAt })
    .from(prs)
    .where(gte(prs.createdAt, since))
    .all();

  // 빈 bucket 도 포함되도록 미리 채움.
  const buckets = new Map<string, number>();
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.now() - (days - 1 - i) * ONE_DAY_MS);
    buckets.set(dateKey(d), 0);
  }
  for (const row of rows) {
    const key = dateKey(row.createdAt);
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return Array.from(buckets.entries()).map(([date, count]) => ({ date, count }));
}

// 일별 머지 추이 — kind 별 (auto/human/github) stacked. updatedAt 기준 (status=merged 전환 시각).
export type DailyMergeBreakdown = {
  date: string;
  auto: number;
  human: number;
  github: number;
};

export function getDailyMergeBreakdown(days: number = 7): DailyMergeBreakdown[] {
  const since = new Date(Date.now() - days * ONE_DAY_MS);

  const merged = db
    .select({
      prId: prs.id,
      updatedAt: prs.updatedAt,
      decision: triageDecisions.decision,
      decidedBy: triageDecisions.decidedBy,
    })
    .from(prs)
    .leftJoin(triageDecisions, eq(triageDecisions.prId, prs.id))
    .where(and(eq(prs.status, 'merged'), gte(prs.updatedAt, since)))
    .all();

  const buckets = new Map<string, DailyMergeBreakdown>();
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.now() - (days - 1 - i) * ONE_DAY_MS);
    buckets.set(dateKey(d), { date: dateKey(d), auto: 0, human: 0, github: 0 });
  }

  for (const row of merged) {
    const key = dateKey(row.updatedAt);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    const kind: MergeKind =
      row.decision === 'auto-merge' && row.decidedBy === 'system'
        ? 'auto'
        : row.decidedBy === 'human'
          ? 'human'
          : 'github';
    bucket[kind] += 1;
  }

  return Array.from(buckets.values());
}

// 일별 평균 신뢰 점수 — preReviews 의 analyzedAt 기준 버킷팅("그 날 수행된 분석"의 평균).
// preReview 가 있는 PR 만 — AI off 기간엔 빈 점이 생길 수 있음.
export type DailyAvgConfidence = { date: string; avg: number | null };

export function getDailyAvgConfidence(days: number = 7): DailyAvgConfidence[] {
  const since = new Date(Date.now() - days * ONE_DAY_MS);
  // 분석 시점(analyzedAt) 기준 버킷팅. 예전엔 prs.createdAt(PR 생성일)로 묶어, 며칠 전 만든 PR 을
  // 오늘 재분석하면 그 신뢰도가 생성일 버킷에 잘못 들어가 그래프의 날짜 축이 어긋났다(리뷰 발견).
  // 분석 1건 = 그 분석일의 데이터 1점. prs 조인 불필요 — preReviews 만으로 충분.
  const rows = db
    .select({ analyzedAt: preReviews.analyzedAt, confidence: preReviews.confidence })
    .from(preReviews)
    .where(gte(preReviews.analyzedAt, since))
    .all();

  const sums = new Map<string, { sum: number; n: number }>();
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.now() - (days - 1 - i) * ONE_DAY_MS);
    sums.set(dateKey(d), { sum: 0, n: 0 });
  }
  for (const row of rows) {
    const key = dateKey(row.analyzedAt);
    const bucket = sums.get(key);
    if (!bucket) continue;
    bucket.sum += row.confidence;
    bucket.n += 1;
  }
  return Array.from(sums.entries()).map(([date, { sum, n }]) => ({
    date,
    avg: n > 0 ? Math.round(sum / n) : null,
  }));
}

// revert 의심 PR — title 이 'Revert ' 로 시작하는 PR.
// 정확한 revert 매칭은 GitHub head_sha → 머지된 PR 시퀀스 추적이 필요하지만,
// 첫 버전은 휴리스틱: title prefix 만으로 충분 (GitHub revert UI 가 만드는 기본 형식).
export type RevertSuspicion = {
  prId: number;
  number: number;
  title: string;
  slug: string;
  mergedAt: Date | null;
  status: string;
};

export function listRevertSuspicions(limit: number = 20): RevertSuspicion[] {
  const rows = db
    .select({
      prId: prs.id,
      number: prs.number,
      title: prs.title,
      slug: projects.slug,
      updatedAt: prs.updatedAt,
      status: prs.status,
    })
    .from(prs)
    .innerJoin(projects, eq(projects.id, prs.repoId))
    .where(like(prs.title, 'Revert %'))
    .orderBy(desc(prs.updatedAt))
    .limit(limit)
    .all();

  return rows.map((r) => ({
    prId: r.prId,
    number: r.number,
    title: r.title,
    slug: r.slug,
    mergedAt: r.status === 'merged' ? r.updatedAt : null,
    status: r.status,
  }));
}

// Phase 4.7 — 머지 결과 피드백(자동 머지 정확도). GitHub revert UI 가 만드는 PR 제목
// `Revert "<원본 subject> (#N)"` 에서 원본 PR 번호 N 을 추출. squash 머지 subject 가 `제목 (#N)`
// 이므로 끝의 `(#N)` 이 원본 번호. 매칭 안 되면 null. 순수 함수 — DB 무관, 테스트 가능.
export function extractRevertedPrNumber(revertTitle: string): number | null {
  const m = revertTitle.match(/^Revert\s+".*\(#(\d+)\)"\s*$/);
  return m ? Number(m[1]) : null;
}

// 자동 머지 정확도 — 자동 머지된 PR(decidedBy=system·decision=auto-merge·merged) 중 나중에 revert
// 된 비율로 false-positive(머지하지 말았어야 할 PR을 머지)를 가시화. "머지 결과 피드백 학습"의
// 결정적 기반 — 임계·플래그 튜닝의 측정 지표. (실제 자동 조정은 데이터 축적 후 별도.)
export type AutoMergeAccuracy = {
  windowDays: number;
  autoMerged: number;
  reverted: number;
  accuracyPct: number; // (autoMerged-reverted)/autoMerged*100, autoMerged=0 이면 100
};

export function getAutoMergeAccuracy(windowDays: number = 30): AutoMergeAccuracy {
  const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const autoMerged = db
    .select({ repoId: prs.repoId, number: prs.number })
    .from(prs)
    .innerJoin(triageDecisions, eq(triageDecisions.prId, prs.id))
    .where(
      and(
        eq(prs.status, 'merged'),
        eq(triageDecisions.decision, 'auto-merge'),
        eq(triageDecisions.decidedBy, 'system'),
        gte(prs.updatedAt, cutoff),
      ),
    )
    .all();
  if (autoMerged.length === 0) {
    return { windowDays, autoMerged: 0, reverted: 0, accuracyPct: 100 };
  }
  // revert PR 들의 (repoId, 원본번호) 집합. 같은 레포에서 원본 번호가 일치하면 revert 로 간주.
  const reverts = db
    .select({ repoId: prs.repoId, title: prs.title })
    .from(prs)
    .where(like(prs.title, 'Revert %'))
    .all();
  const revertedKeys = new Set<string>();
  for (const r of reverts) {
    const n = extractRevertedPrNumber(r.title);
    if (n !== null) revertedKeys.add(`${r.repoId}:${n}`);
  }
  let reverted = 0;
  for (const pr of autoMerged) {
    if (revertedKeys.has(`${pr.repoId}:${pr.number}`)) reverted += 1;
  }
  const accuracyPct = Math.round(((autoMerged.length - reverted) / autoMerged.length) * 100);
  return { windowDays, autoMerged: autoMerged.length, reverted, accuracyPct };
}

// 단일 진입점 — page.tsx 가 한 번에 호출.
export type ReportsData = {
  mergeRate: MergeRateSummary;
  prevMergeRate: MergeRateSummary; // 지난 7일 (비교용)
  dailyIncoming: DailyCount[];
  dailyMerges: DailyMergeBreakdown[];
  dailyAvgConfidence: DailyAvgConfidence[];
  reverts: RevertSuspicion[];
  autoMergeAccuracy: AutoMergeAccuracy;
};

export function getReportsData(): ReportsData {
  // 비교용 — 지난 7일.
  const prevSince = new Date(Date.now() - 2 * ONE_WEEK_MS);
  const prevUntil = new Date(Date.now() - ONE_WEEK_MS);

  const prevAutoRow = db
    .select({ n: sql<number>`count(*)` })
    .from(prs)
    .innerJoin(triageDecisions, eq(triageDecisions.prId, prs.id))
    .where(
      and(
        eq(prs.status, 'merged'),
        gte(prs.updatedAt, prevSince),
        lt(prs.updatedAt, prevUntil),
        eq(triageDecisions.decision, 'auto-merge'),
        eq(triageDecisions.decidedBy, 'system'),
      ),
    )
    .get();

  const prevHumanRow = db
    .select({ n: sql<number>`count(*)` })
    .from(prs)
    .innerJoin(triageDecisions, eq(triageDecisions.prId, prs.id))
    .where(
      and(
        eq(prs.status, 'merged'),
        gte(prs.updatedAt, prevSince),
        lt(prs.updatedAt, prevUntil),
        eq(triageDecisions.decidedBy, 'human'),
      ),
    )
    .get();

  const prevTotalRow = db
    .select({ n: sql<number>`count(*)` })
    .from(prs)
    .where(
      and(eq(prs.status, 'merged'), gte(prs.updatedAt, prevSince), lt(prs.updatedAt, prevUntil)),
    )
    .get();

  const prevAuto = prevAutoRow?.n ?? 0;
  const prevHuman = prevHumanRow?.n ?? 0;
  const prevTotal = prevTotalRow?.n ?? 0;
  const prevGithub = Math.max(0, prevTotal - prevAuto - prevHuman);
  const prevRate = prevTotal > 0 ? Math.round((prevAuto / prevTotal) * 100) : 0;

  return {
    mergeRate: getMergeRateSummary(7),
    prevMergeRate: {
      windowDays: 7,
      autoCount: prevAuto,
      humanCount: prevHuman,
      githubCount: prevGithub,
      totalMerged: prevTotal,
      autoMergeRate: prevRate,
    },
    dailyIncoming: getDailyIncomingPRs(7),
    dailyMerges: getDailyMergeBreakdown(7),
    dailyAvgConfidence: getDailyAvgConfidence(7),
    reverts: listRevertSuspicions(20),
    autoMergeAccuracy: getAutoMergeAccuracy(30),
  };
}
