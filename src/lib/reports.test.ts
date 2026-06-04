import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/client';
import { notifications, preReviews, prs, projects, triageDecisions } from '@/db/schema';
import {
  extractRevertedPrNumber,
  getAutoMergeAccuracy,
  getDailyAvgConfidence,
  getDailyIncomingPRs,
  getDailyMergeBreakdown,
  getMergeRateSummary,
  listRevertSuspicions,
} from './reports';

beforeAll(() => {
  migrate(db, { migrationsFolder: 'src/db/migrations' });
});

beforeEach(() => {
  db.delete(notifications).run();
  db.delete(triageDecisions).run();
  db.delete(preReviews).run();
  db.delete(prs).run();
  db.delete(projects).run();
});

function seedMergedPR(opts: {
  slug?: string;
  number?: number;
  title?: string;
  decision?: 'auto-merge' | null;
  decidedBy?: 'system' | 'human' | null;
  updatedAt?: Date;
  createdAt?: Date;
  confidence?: number;
  analyzedAt?: Date;
}) {
  const slug = opts.slug ?? 'acme/web';
  // 같은 슬러그 재사용 — 한 테스트에서 여러 PR 을 같은 project 에 묶기 위함.
  const existing = db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, slug))
    .get();
  const project =
    existing ??
    db.insert(projects).values({ slug, name: 'Web' }).returning({ id: projects.id }).get();
  const now = opts.updatedAt ?? new Date();
  const pr = db
    .insert(prs)
    .values({
      repoId: project.id,
      number: opts.number ?? Math.floor(Math.random() * 10000),
      title: opts.title ?? 'PR',
      authorKind: 'agent',
      authorId: 'claude',
      headSha: 'sha-' + Math.random().toString(36).slice(2, 9),
      linesAdded: 1,
      linesRemoved: 0,
      filesChanged: 1,
      status: 'merged',
      createdAt: opts.createdAt ?? now,
      updatedAt: now,
    })
    .returning({ id: prs.id })
    .get();
  if (opts.decision && opts.decidedBy) {
    db.insert(triageDecisions)
      .values({
        prId: pr.id,
        decision: opts.decision,
        reason: 'test',
        decidedBy: opts.decidedBy,
      })
      .run();
  }
  if (opts.confidence !== undefined) {
    db.insert(preReviews)
      .values({
        prId: pr.id,
        headSha: 'sha',
        confidence: opts.confidence,
        confidenceTier: 'high',
        flags: [],
        ...(opts.analyzedAt ? { analyzedAt: opts.analyzedAt } : {}),
      })
      .run();
  }
  return pr.id;
}

describe('getMergeRateSummary', () => {
  it('zero merges → 0%', () => {
    const s = getMergeRateSummary(7);
    expect(s.totalMerged).toBe(0);
    expect(s.autoMergeRate).toBe(0);
  });

  it('counts auto / human / github merges separately', () => {
    seedMergedPR({ decision: 'auto-merge', decidedBy: 'system', number: 1 });
    seedMergedPR({ decision: 'auto-merge', decidedBy: 'human', number: 2 });
    seedMergedPR({ number: 3 }); // github 직접 머지 — triage decision 없음.
    const s = getMergeRateSummary(7);
    expect(s.autoCount).toBe(1);
    expect(s.humanCount).toBe(1);
    expect(s.githubCount).toBe(1);
    expect(s.totalMerged).toBe(3);
    expect(s.autoMergeRate).toBe(33);
  });

  it('excludes merges older than window', () => {
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    seedMergedPR({ decision: 'auto-merge', decidedBy: 'system', updatedAt: old });
    const s = getMergeRateSummary(7);
    expect(s.totalMerged).toBe(0);
  });
});

describe('getDailyIncomingPRs', () => {
  it('returns days entries with zero buckets filled', () => {
    const days = getDailyIncomingPRs(7);
    expect(days.length).toBe(7);
    expect(days.every((d) => d.count === 0)).toBe(true);
  });

  it('aggregates by day', () => {
    seedMergedPR({ number: 1 });
    seedMergedPR({ number: 2 });
    const days = getDailyIncomingPRs(7);
    const total = days.reduce((s, d) => s + d.count, 0);
    expect(total).toBe(2);
  });
});

describe('getDailyMergeBreakdown', () => {
  it('splits by kind in same day', () => {
    seedMergedPR({ decision: 'auto-merge', decidedBy: 'system', number: 1 });
    seedMergedPR({ decision: 'auto-merge', decidedBy: 'human', number: 2 });
    seedMergedPR({ number: 3 });
    const days = getDailyMergeBreakdown(7);
    const today = days[days.length - 1];
    expect(today.auto).toBe(1);
    expect(today.human).toBe(1);
    expect(today.github).toBe(1);
  });
});

describe('getDailyAvgConfidence', () => {
  it('averages confidence per day, null for empty days', () => {
    seedMergedPR({ number: 1, confidence: 80 });
    seedMergedPR({ number: 2, confidence: 90 });
    const days = getDailyAvgConfidence(7);
    const today = days[days.length - 1];
    expect(today.avg).toBe(85);
    // 다른 날은 null.
    expect(days.slice(0, -1).every((d) => d.avg === null)).toBe(true);
  });

  // 회귀(리뷰 발견): 예전엔 prs.createdAt 으로 버킷팅해 며칠 전 만든 PR 을 오늘 재분석하면
  // 신뢰도가 생성일 버킷에 잘못 들어갔다. 이제는 analyzedAt 기준 → 분석 시점의 버킷에만 기록.
  it('analyzedAt 기준 버킷팅 — PR 생성일과 분석일이 다르면 분석일 점에 기록', () => {
    const now = new Date();
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    // 3일 전에 만든 PR 을 오늘 분석.
    seedMergedPR({
      number: 1,
      confidence: 70,
      createdAt: threeDaysAgo,
      updatedAt: threeDaysAgo,
      analyzedAt: now,
    });
    const days = getDailyAvgConfidence(7);
    const today = days[days.length - 1];
    const threeDaysIdx = days.length - 4; // 7일 창 끝에서 -3 = 3일 전.
    // 오늘 버킷에 점이 찍힘 — 예전엔 3일 전 버킷에 잘못 들어갔음.
    expect(today.avg).toBe(70);
    expect(days[threeDaysIdx].avg).toBeNull();
  });

  it('같은 PR 의 여러 분석은 각 분석일 버킷에 분산 기록', () => {
    const now = new Date();
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    // 같은 PR 의 두 번 분석 (재푸시 시뮬). 헬퍼가 PR 당 preReview 1건만 만들므로 직접 삽입.
    const prId = seedMergedPR({ number: 1, confidence: 60, analyzedAt: twoDaysAgo });
    db.insert(preReviews)
      .values({
        prId,
        headSha: 'sha-new',
        confidence: 90,
        confidenceTier: 'high',
        flags: [],
        analyzedAt: now,
      })
      .run();

    const days = getDailyAvgConfidence(7);
    const today = days[days.length - 1];
    const twoDaysIdx = days.length - 3;
    expect(today.avg).toBe(90); // 오늘 분석.
    expect(days[twoDaysIdx].avg).toBe(60); // 2일 전 분석.
  });
});

describe('listRevertSuspicions', () => {
  it('only includes title starting with "Revert "', () => {
    seedMergedPR({ title: 'Revert "Add bad feature"', number: 1 });
    seedMergedPR({ title: 'Add feature', number: 2 });
    const list = listRevertSuspicions();
    expect(list.length).toBe(1);
    expect(list[0].title).toMatch(/^Revert /);
  });

  it('limit caps result', () => {
    for (let i = 0; i < 5; i++) {
      seedMergedPR({ title: `Revert PR ${i}`, number: 100 + i });
    }
    const list = listRevertSuspicions(3);
    expect(list.length).toBe(3);
  });
});

describe('extractRevertedPrNumber', () => {
  it('Revert "제목 (#N)" 에서 N 추출', () => {
    expect(extractRevertedPrNumber('Revert "feat: x (#42)"')).toBe(42);
    expect(extractRevertedPrNumber('Revert "fix: 버그 (#1234)"')).toBe(1234);
  });
  it('번호 없거나 형식 안 맞으면 null', () => {
    expect(extractRevertedPrNumber('Revert "no number"')).toBeNull();
    expect(extractRevertedPrNumber('feat: 일반 PR')).toBeNull();
    expect(extractRevertedPrNumber('Revert something (#5)')).toBeNull(); // 따옴표 없음
  });
});

describe('getAutoMergeAccuracy', () => {
  it('자동 머지 0건이면 accuracy 100', () => {
    expect(getAutoMergeAccuracy(30)).toEqual({
      windowDays: 30,
      autoMerged: 0,
      reverted: 0,
      accuracyPct: 100,
    });
  });

  it('자동 머지된 PR 중 revert 된 것을 false-positive 로 집계', () => {
    // 자동 머지 2건(#42, #43) + 사람 머지 1건(#44, 제외).
    seedMergedPR({ number: 42, decision: 'auto-merge', decidedBy: 'system' });
    seedMergedPR({ number: 43, decision: 'auto-merge', decidedBy: 'system' });
    seedMergedPR({ number: 44, decision: 'auto-merge', decidedBy: 'human' });
    // #42 를 되돌리는 revert PR (같은 레포).
    seedMergedPR({ number: 99, title: 'Revert "feat: x (#42)"' });

    const r = getAutoMergeAccuracy(30);
    expect(r.autoMerged).toBe(2); // system auto-merge 만
    expect(r.reverted).toBe(1); // #42
    expect(r.accuracyPct).toBe(50);
  });

  it('다른 레포의 같은 번호 revert 는 매칭 안 됨', () => {
    seedMergedPR({ slug: 'a/x', number: 42, decision: 'auto-merge', decidedBy: 'system' });
    seedMergedPR({ slug: 'b/y', number: 99, title: 'Revert "z (#42)"' }); // 다른 레포
    const r = getAutoMergeAccuracy(30);
    expect(r.autoMerged).toBe(1);
    expect(r.reverted).toBe(0);
    expect(r.accuracyPct).toBe(100);
  });
});
