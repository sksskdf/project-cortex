import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/client';
import { preReviews, prs, projects, triageDecisions } from '@/db/schema';
import { getDashboardStats, getTodayRows } from './dashboard';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

beforeAll(() => {
  migrate(db, { migrationsFolder: 'src/db/migrations' });
});

beforeEach(() => {
  db.delete(triageDecisions).run();
  db.delete(preReviews).run();
  db.delete(prs).run();
  db.delete(projects).run();
});

function setupProject(slug = 'acme/web', muted = false): number {
  return db
    .insert(projects)
    .values({ slug, name: slug, muted })
    .returning({ id: projects.id })
    .get().id;
}

function setupPR(opts: {
  repoId: number;
  number: number;
  status: 'review-needed' | 'merged' | 'open' | 'auto-mergeable' | 'closed';
  createdAt: Date;
  updatedAt?: Date;
  confidence?: number;
  analyzedAt?: Date;
  // 머지된 PR 에 대해 자동 머지 카운트에 포함시킬지. 디폴트 true (이전 동작 호환).
  // false 면 triage decision 안 만듦 → GitHub 외부 머지로 분류.
  autoMerged?: boolean;
}) {
  const pr = db
    .insert(prs)
    .values({
      repoId: opts.repoId,
      number: opts.number,
      title: `PR ${opts.number}`,
      authorKind: 'agent',
      authorId: 'devin',
      headSha: `sha-${opts.number}`,
      linesAdded: 10,
      linesRemoved: 1,
      filesChanged: 1,
      status: opts.status,
      createdAt: opts.createdAt,
      updatedAt: opts.updatedAt ?? opts.createdAt,
    })
    .returning({ id: prs.id })
    .get();
  if (opts.confidence !== undefined && opts.analyzedAt !== undefined) {
    db.insert(preReviews)
      .values({
        prId: pr.id,
        headSha: `sha-${opts.number}`,
        confidence: opts.confidence,
        confidenceTier: 'medium',
        flags: [],
        analyzedAt: opts.analyzedAt,
      })
      .run();
  }
  // merged 상태인 PR 은 디폴트로 시스템 자동 머지 결정을 기록 — 자동 카운트에 잡힘.
  if (opts.status === 'merged' && opts.autoMerged !== false) {
    db.insert(triageDecisions)
      .values({
        prId: pr.id,
        decision: 'auto-merge',
        reason: 'test auto merge',
        decidedBy: 'system',
      })
      .run();
  }
  return pr.id;
}

describe('getDashboardStats — 실 delta 계산', () => {
  it('빈 DB → 모든 stat 0, 모든 delta flat', async () => {
    const s = await getDashboardStats();
    expect(s.pendingReview.value).toBe(0);
    expect(s.autoMergedThisWeek.value).toBe(0);
    expect(s.avgConfidence.value).toBe(0);
    expect(s.pendingReview.delta.direction).toBe('flat');
    expect(s.autoMergedThisWeek.delta.direction).toBe('flat');
    expect(s.avgConfidence.delta.direction).toBe('flat');
  });

  it('이번 주 신규가 더 많으면 pendingReview.delta=up', async () => {
    const now = Date.now();
    const repoId = setupProject();
    // 이번 주 3건, 지난 주 1건.
    setupPR({
      repoId,
      number: 1,
      status: 'review-needed',
      createdAt: new Date(now - 1 * ONE_DAY_MS),
    });
    setupPR({
      repoId,
      number: 2,
      status: 'review-needed',
      createdAt: new Date(now - 2 * ONE_DAY_MS),
    });
    setupPR({
      repoId,
      number: 3,
      status: 'review-needed',
      createdAt: new Date(now - 3 * ONE_DAY_MS),
    });
    setupPR({
      repoId,
      number: 4,
      status: 'review-needed',
      createdAt: new Date(now - 10 * ONE_DAY_MS),
    });

    const s = await getDashboardStats();
    expect(s.pendingReview.value).toBe(4);
    expect(s.pendingReview.delta.direction).toBe('up');
    expect(s.pendingReview.delta.amount).toBe(2); // 3 - 1
    expect(s.pendingReview.delta.comparedTo).toContain('지난 주');
  });

  it('이번 주 머지가 적으면 autoMergedThisWeek.delta=down', async () => {
    const now = Date.now();
    const repoId = setupProject();
    // 이번 주 1건, 지난 주 3건.
    setupPR({
      repoId,
      number: 1,
      status: 'merged',
      createdAt: new Date(now - 1 * ONE_DAY_MS),
      updatedAt: new Date(now - 1 * ONE_DAY_MS),
    });
    [10, 11, 12].forEach((n) =>
      setupPR({
        repoId,
        number: n,
        status: 'merged',
        createdAt: new Date(now - 10 * ONE_DAY_MS),
        updatedAt: new Date(now - 10 * ONE_DAY_MS),
      }),
    );

    const s = await getDashboardStats();
    expect(s.autoMergedThisWeek.value).toBe(1);
    expect(s.autoMergedThisWeek.delta.direction).toBe('down');
    expect(s.autoMergedThisWeek.delta.amount).toBe(2); // |1 - 3|
  });

  it('avgConfidence.delta — 이번 주 분석 vs 지난 주 분석 평균', async () => {
    const now = Date.now();
    const repoId = setupProject();
    // 이번 주 분석 평균 90, 지난 주 평균 70.
    setupPR({
      repoId,
      number: 1,
      status: 'review-needed',
      createdAt: new Date(now),
      confidence: 90,
      analyzedAt: new Date(now - 1 * ONE_DAY_MS),
    });
    setupPR({
      repoId,
      number: 2,
      status: 'review-needed',
      createdAt: new Date(now),
      confidence: 70,
      analyzedAt: new Date(now - 10 * ONE_DAY_MS),
    });

    const s = await getDashboardStats();
    expect(s.avgConfidence.value).toBe(80); // 전체 평균.
    expect(s.avgConfidence.delta.direction).toBe('up');
    expect(s.avgConfidence.delta.amount).toBe(20);
  });

  it('동일 값이면 direction=flat, amount=0', async () => {
    const now = Date.now();
    const repoId = setupProject();
    // 이번 주 1건, 지난 주 1건 — 동일.
    setupPR({
      repoId,
      number: 1,
      status: 'review-needed',
      createdAt: new Date(now - 1 * ONE_DAY_MS),
    });
    setupPR({
      repoId,
      number: 2,
      status: 'review-needed',
      createdAt: new Date(now - 10 * ONE_DAY_MS),
    });

    const s = await getDashboardStats();
    expect(s.pendingReview.delta.direction).toBe('flat');
    expect(s.pendingReview.delta.amount).toBe(0);
  });

  it('autoMergedThisWeek — 사람 머지/외부 머지는 제외, 시스템 자동만 카운트', async () => {
    const now = Date.now();
    const repoId = setupProject();
    // 자동 머지 1건 (default triage decision = auto + system).
    setupPR({
      repoId,
      number: 1,
      status: 'merged',
      createdAt: new Date(now - 1 * ONE_DAY_MS),
      updatedAt: new Date(now - 1 * ONE_DAY_MS),
    });
    // 사람 머지 1건 — triage decision 은 직접 'human' 으로.
    const humanId = setupPR({
      repoId,
      number: 2,
      status: 'merged',
      createdAt: new Date(now - 1 * ONE_DAY_MS),
      updatedAt: new Date(now - 1 * ONE_DAY_MS),
      autoMerged: false,
    });
    db.insert(triageDecisions)
      .values({
        prId: humanId,
        decision: 'auto-merge',
        reason: 'user clicked merge',
        decidedBy: 'human',
      })
      .run();
    // 외부 머지 1건 — triage decision 없음.
    setupPR({
      repoId,
      number: 3,
      status: 'merged',
      createdAt: new Date(now - 1 * ONE_DAY_MS),
      updatedAt: new Date(now - 1 * ONE_DAY_MS),
      autoMerged: false,
    });

    const s = await getDashboardStats();
    expect(s.autoMergedThisWeek.value).toBe(1);
  });

  it('pendingReview — 뮤트된 프로젝트의 review-needed PR 은 stat·delta 에서 제외', async () => {
    const now = Date.now();
    const active = setupProject('acme/web', false);
    const muted = setupProject('acme/muted', true);
    // 활성: 이번 주 1건.
    setupPR({
      repoId: active,
      number: 1,
      status: 'review-needed',
      createdAt: new Date(now - 1 * ONE_DAY_MS),
    });
    // 뮤트: 이번 주 2건 — value/delta 어디에도 잡히면 안 됨.
    setupPR({
      repoId: muted,
      number: 2,
      status: 'review-needed',
      createdAt: new Date(now - 1 * ONE_DAY_MS),
    });
    setupPR({
      repoId: muted,
      number: 3,
      status: 'review-needed',
      createdAt: new Date(now - 2 * ONE_DAY_MS),
    });

    const s = await getDashboardStats();
    expect(s.pendingReview.value).toBe(1);
  });
});

describe('getTodayRows — 지금 처리할 것 위젯', () => {
  it('뮤트된 프로젝트의 PR 은 위젯에 노출되지 않음', async () => {
    const now = Date.now();
    const active = setupProject('acme/web', false);
    const muted = setupProject('acme/muted', true);
    const visible = setupPR({
      repoId: active,
      number: 1,
      status: 'review-needed',
      createdAt: new Date(now - 1 * ONE_DAY_MS),
      confidence: 70,
      analyzedAt: new Date(now - 1 * ONE_DAY_MS),
    });
    setupPR({
      repoId: muted,
      number: 2,
      status: 'review-needed',
      createdAt: new Date(now - 1 * ONE_DAY_MS),
      confidence: 70,
      analyzedAt: new Date(now - 1 * ONE_DAY_MS),
    });

    const rows = await getTodayRows(10);
    expect(rows.map((r) => Number(r.id.replace('pr-', '')))).toEqual([visible]);
  });
});
