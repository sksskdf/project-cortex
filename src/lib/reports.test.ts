import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/client';
import { notifications, preReviews, prs, projects, triageDecisions } from '@/db/schema';
import {
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
