import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/client';
import { agentRuns, issues, preReviews, prs, projects, triageDecisions } from '@/db/schema';
import { getAgentWorkloads, getDashboardStats, getTodayRows } from './dashboard';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

beforeAll(() => {
  migrate(db, { migrationsFolder: 'src/db/migrations' });
});

beforeEach(() => {
  db.delete(agentRuns).run();
  db.delete(issues).run();
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

  it('autoMergedThisWeek — 뮤트된 프로젝트의 자동 머지는 카운트·delta 에서 제외', async () => {
    const now = Date.now();
    const active = setupProject('acme/web', false);
    const muted = setupProject('acme/muted', true);
    // 활성: 이번 주 1건 자동 머지.
    setupPR({
      repoId: active,
      number: 1,
      status: 'merged',
      createdAt: new Date(now - 1 * ONE_DAY_MS),
      updatedAt: new Date(now - 1 * ONE_DAY_MS),
    });
    // 뮤트: 이번 주 2건 — 카운트에 잡히면 안 됨 (pendingReview 와 일관).
    setupPR({
      repoId: muted,
      number: 2,
      status: 'merged',
      createdAt: new Date(now - 1 * ONE_DAY_MS),
      updatedAt: new Date(now - 1 * ONE_DAY_MS),
    });
    setupPR({
      repoId: muted,
      number: 3,
      status: 'merged',
      createdAt: new Date(now - 1 * ONE_DAY_MS),
      updatedAt: new Date(now - 1 * ONE_DAY_MS),
    });
    // 뮤트: 지난 주 1건 — delta 에도 잡히면 안 됨.
    setupPR({
      repoId: muted,
      number: 4,
      status: 'merged',
      createdAt: new Date(now - 10 * ONE_DAY_MS),
      updatedAt: new Date(now - 10 * ONE_DAY_MS),
    });

    const s = await getDashboardStats();
    // 뮤트 제외 후: 이번 주 1건(활성), 지난 주 0건(뮤트만 있었음). delta up 1.
    expect(s.autoMergedThisWeek.value).toBe(1);
    expect(s.autoMergedThisWeek.delta.direction).toBe('up');
    expect(s.autoMergedThisWeek.delta.amount).toBe(1);
  });

  it('humanMergedThisWeek — 뮤트된 프로젝트의 사람 머지는 카운트에서 제외', async () => {
    const now = Date.now();
    const active = setupProject('acme/web', false);
    const muted = setupProject('acme/muted', true);
    // 활성 사람 머지 1건.
    const activeHuman = setupPR({
      repoId: active,
      number: 1,
      status: 'merged',
      createdAt: new Date(now - 1 * ONE_DAY_MS),
      updatedAt: new Date(now - 1 * ONE_DAY_MS),
      autoMerged: false,
    });
    db.insert(triageDecisions)
      .values({
        prId: activeHuman,
        decision: 'auto-merge',
        reason: 'user clicked merge',
        decidedBy: 'human',
      })
      .run();
    // 뮤트 사람 머지 2건 — 카운트 제외.
    [2, 3].forEach((n) => {
      const id = setupPR({
        repoId: muted,
        number: n,
        status: 'merged',
        createdAt: new Date(now - 1 * ONE_DAY_MS),
        updatedAt: new Date(now - 1 * ONE_DAY_MS),
        autoMerged: false,
      });
      db.insert(triageDecisions)
        .values({
          prId: id,
          decision: 'auto-merge',
          reason: 'user clicked merge',
          decidedBy: 'human',
        })
        .run();
    });

    const s = await getDashboardStats();
    expect(s.humanMergedThisWeek.value).toBe(1);
  });

  it('avgConfidence — 같은 PR 의 과거 SHA 분석은 평균에서 제외 (현재 head 만)', async () => {
    const now = Date.now();
    const repoId = setupProject();
    // PR 1 의 현재 head 는 sha-1, confidence=80. 과거 SHA(sha-old) 분석 confidence=20 행도 존재.
    const pr1 = db
      .insert(prs)
      .values({
        repoId,
        number: 1,
        title: 'PR 1',
        authorKind: 'agent',
        authorId: 'devin',
        headSha: 'sha-1',
        linesAdded: 10,
        linesRemoved: 1,
        filesChanged: 1,
        status: 'review-needed',
        createdAt: new Date(now),
        updatedAt: new Date(now),
      })
      .returning({ id: prs.id })
      .get();
    // 과거 SHA 의 stale preReview (재푸시 전).
    db.insert(preReviews)
      .values({
        prId: pr1.id,
        headSha: 'sha-old',
        confidence: 20,
        confidenceTier: 'critical',
        flags: [],
        analyzedAt: new Date(now - 2 * ONE_DAY_MS),
      })
      .run();
    // 현재 head 의 preReview.
    db.insert(preReviews)
      .values({
        prId: pr1.id,
        headSha: 'sha-1',
        confidence: 80,
        confidenceTier: 'medium',
        flags: [],
        analyzedAt: new Date(now - 1 * ONE_DAY_MS),
      })
      .run();

    const s = await getDashboardStats();
    // 예전: avg(20, 80) = 50. 이제: 현재 head 인 80 만 → 80.
    expect(s.avgConfidence.value).toBe(80);
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

describe('getAgentWorkloads', () => {
  // 진행 중 agent_runs 가 0 이면 빈 배열 — UI 가 빈 상태 안내를 렌더.
  it('진행 중 runs 없으면 빈 배열', () => {
    expect(getAgentWorkloads()).toEqual([]);
  });

  it('에이전트별로 running/queued 카운트 + running desc 정렬', () => {
    const repoId = setupProject();
    const issueId = db
      .insert(issues)
      .values({ repoId, title: 't', spec: 's', assigneeKind: 'agent', assigneeId: 'devin' })
      .returning({ id: issues.id })
      .get().id;
    // devin: running 2, queued 1. codex: running 1.
    db.insert(agentRuns).values({ issueId, agent: 'devin', status: 'running' }).run();
    db.insert(agentRuns).values({ issueId, agent: 'devin', status: 'running' }).run();
    db.insert(agentRuns).values({ issueId, agent: 'devin', status: 'queued' }).run();
    db.insert(agentRuns).values({ issueId, agent: 'codex', status: 'running' }).run();
    // 완료/실패는 카운트에 안 잡힘.
    db.insert(agentRuns).values({ issueId, agent: 'devin', status: 'completed' }).run();
    db.insert(agentRuns).values({ issueId, agent: 'codex', status: 'failed' }).run();

    const rows = getAgentWorkloads();
    expect(rows).toEqual([
      { agent: 'devin', running: 2, queued: 1, recentEtaText: null },
      { agent: 'codex', running: 1, queued: 0, recentEtaText: null },
    ]);
  });

  it('14일 내 완료 runs 의 평균 etaSec → 사람용 ETA 텍스트', () => {
    const repoId = setupProject();
    const issueId = db
      .insert(issues)
      .values({ repoId, title: 't', spec: 's', assigneeKind: 'agent', assigneeId: 'devin' })
      .returning({ id: issues.id })
      .get().id;
    db.insert(agentRuns).values({ issueId, agent: 'devin', status: 'running' }).run();
    // 완료 runs: 60s, 120s, 180s → 평균 120s → "~2분"
    db.insert(agentRuns)
      .values({ issueId, agent: 'devin', status: 'completed', etaSec: 60, completedAt: new Date() })
      .run();
    db.insert(agentRuns)
      .values({
        issueId,
        agent: 'devin',
        status: 'completed',
        etaSec: 120,
        completedAt: new Date(),
      })
      .run();
    db.insert(agentRuns)
      .values({
        issueId,
        agent: 'devin',
        status: 'completed',
        etaSec: 180,
        completedAt: new Date(),
      })
      .run();

    const rows = getAgentWorkloads();
    expect(rows[0].recentEtaText).toBe('~2분');
  });
});
