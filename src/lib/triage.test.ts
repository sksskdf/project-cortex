import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/client';
import { clusters, preReviews, prs, projects, triageDecisions } from '@/db/schema';
import { decideTriage, runTriage, type TriageInput } from './triage';

function base(overrides: Partial<TriageInput> = {}): TriageInput {
  return {
    authorKind: 'agent',
    confidence: 95,
    flags: [],
    testsPassed: true,
    autoMergeEnabled: true,
    ...overrides,
  };
}

describe('decideTriage', () => {
  it('auto-merge when all conditions met', () => {
    const r = decideTriage(base());
    expect(r.decision).toBe('auto-merge');
  });

  it('human-review for human author regardless of other signals', () => {
    const r = decideTriage(base({ authorKind: 'human', confidence: 100 }));
    expect(r.decision).toBe('human-review');
    expect(r.reason).toContain('사람 작성 PR');
  });

  it('human-review when project autoMergeEnabled is false', () => {
    const r = decideTriage(base({ autoMergeEnabled: false }));
    expect(r.decision).toBe('human-review');
    expect(r.reason).toContain('자동 머지 정책이 꺼져');
  });

  it('human-review for payment-domain flag (with reason)', () => {
    const r = decideTriage(base({ flags: ['payment-domain'] }));
    expect(r.decision).toBe('human-review');
    expect(r.reason).toContain('결제 도메인');
  });

  it('human-review for migration flag', () => {
    const r = decideTriage(base({ flags: ['migration'] }));
    expect(r.decision).toBe('human-review');
    expect(r.reason).toContain('마이그레이션');
  });

  it('human-review for any blocking flag (auth-domain)', () => {
    const r = decideTriage(base({ flags: ['auth-domain'] }));
    expect(r.decision).toBe('human-review');
    expect(r.reason).toContain('인증 도메인');
  });

  it('human-review for security-sensitive flag', () => {
    const r = decideTriage(base({ flags: ['security-sensitive'] }));
    expect(r.decision).toBe('human-review');
    expect(r.reason).toContain('보안');
  });

  it('human-review for external-api-new flag', () => {
    const r = decideTriage(base({ flags: ['external-api-new'] }));
    expect(r.decision).toBe('human-review');
    expect(r.reason).toContain('외부 API');
  });

  it('human-review when tests failed', () => {
    const r = decideTriage(base({ testsPassed: false }));
    expect(r.decision).toBe('human-review');
    expect(r.reason).toContain('테스트 실패');
  });

  it('human-review when tests not run (null)', () => {
    const r = decideTriage(base({ testsPassed: null }));
    expect(r.decision).toBe('human-review');
    expect(r.reason).toContain('CI 결과');
  });

  it('auto-merge regardless of confidence — 신뢰점수 게이트 제거 (위험 아니면 자동 머지)', () => {
    // 낮은 신뢰 점수여도 위험 플래그·CI 문제 없으면 자동 머지.
    expect(decideTriage(base({ confidence: 10 })).decision).toBe('auto-merge');
    expect(decideTriage(base({ confidence: 89 })).decision).toBe('auto-merge');
    expect(decideTriage(base({ confidence: 90 })).decision).toBe('auto-merge');
  });

  it('ignores non-blocking flags (low-coverage alone is not a blocker)', () => {
    const r = decideTriage(base({ flags: ['low-coverage'] }));
    expect(r.decision).toBe('auto-merge');
  });

  it('blocking flag wins over high confidence', () => {
    const r = decideTriage(base({ confidence: 100, flags: ['migration'] }));
    expect(r.decision).toBe('human-review');
    expect(r.reason).toContain('마이그레이션');
  });
});

describe('runTriage', () => {
  beforeAll(() => {
    migrate(db, { migrationsFolder: 'src/db/migrations' });
  });

  beforeEach(() => {
    db.delete(triageDecisions).run();
    db.delete(preReviews).run();
    db.delete(prs).run();
    db.delete(clusters).run();
    db.delete(projects).run();
  });

  function setupPR(opts: {
    autoMergeEnabled?: boolean;
    confidence: number;
    flags?: string[];
    testsPassed?: boolean | null;
    authorKind?: 'agent' | 'human';
    status?: 'open' | 'review-needed' | 'auto-mergeable' | 'merged' | 'closed';
    clusterId?: number | null;
  }) {
    const project = db
      .insert(projects)
      .values({
        slug: 'demo',
        name: 'Demo',
        autoMergeEnabled: opts.autoMergeEnabled ?? true,
      })
      .returning({ id: projects.id })
      .get();

    const pr = db
      .insert(prs)
      .values({
        repoId: project.id,
        number: 1,
        title: 'Test',
        authorKind: opts.authorKind ?? 'agent',
        authorId: 'devin',
        headSha: 'sha-1',
        linesAdded: 10,
        linesRemoved: 1,
        filesChanged: 2,
        status: opts.status ?? 'open',
        clusterId: opts.clusterId ?? null,
        // testsPassed 는 prs 컬럼으로 이동 (마이그레이션 0007).
        testsPassed: opts.testsPassed ?? true,
      })
      .returning({ id: prs.id })
      .get();

    db.insert(preReviews)
      .values({
        prId: pr.id,
        headSha: 'sha-1',
        confidence: opts.confidence,
        confidenceTier: opts.confidence >= 90 ? 'high' : 'medium',
        flags: opts.flags ?? [],
      })
      .run();

    return pr.id;
  }

  it('inserts triage_decision and sets PR.status=auto-mergeable when all green', async () => {
    const prId = setupPR({ confidence: 95 });
    const r = await runTriage(prId);
    expect(r.kind).toBe('decided');
    if (r.kind === 'decided') expect(r.decision).toBe('auto-merge');

    const td = db.select().from(triageDecisions).where(eq(triageDecisions.prId, prId)).get();
    expect(td?.decision).toBe('auto-merge');
    expect(db.select().from(prs).where(eq(prs.id, prId)).get()?.status).toBe('auto-mergeable');
  });

  it('sets PR.status=review-needed when blocking flag present', async () => {
    const prId = setupPR({ confidence: 95, flags: ['payment-domain'] });
    const r = await runTriage(prId);
    expect(r.kind).toBe('decided');
    if (r.kind === 'decided') expect(r.decision).toBe('human-review');
    expect(db.select().from(prs).where(eq(prs.id, prId)).get()?.status).toBe('review-needed');
  });

  it('skips when no PreReview row exists', async () => {
    // setupPR 없이 직접 PR만 insert
    const project = db
      .insert(projects)
      .values({ slug: 'demo', name: 'Demo' })
      .returning({ id: projects.id })
      .get();
    const pr = db
      .insert(prs)
      .values({
        repoId: project.id,
        number: 1,
        title: 'No analysis',
        authorKind: 'agent',
        authorId: 'devin',
        headSha: 'sha-x',
        linesAdded: 0,
        linesRemoved: 0,
        filesChanged: 0,
        status: 'open',
      })
      .returning({ id: prs.id })
      .get();

    const r = await runTriage(pr.id);
    expect(r).toEqual({ kind: 'skipped', reason: 'no-pre-review' });
  });

  it('skips merged PRs (no status change)', async () => {
    const prId = setupPR({ confidence: 95, status: 'merged' });
    const r = await runTriage(prId);
    expect(r).toEqual({ kind: 'skipped', reason: 'pr-merged' });
  });

  it('skips closed PRs', async () => {
    const prId = setupPR({ confidence: 95, status: 'closed' });
    const r = await runTriage(prId);
    expect(r).toEqual({ kind: 'skipped', reason: 'pr-closed' });
  });

  it('skips PRs already in a cluster (Phase 6 handles them)', async () => {
    const cl = db
      .insert(clusters)
      .values({ pattern: 'p', title: 't', avgConfidence: 90 })
      .returning({ id: clusters.id })
      .get();
    const prId = setupPR({ confidence: 95, clusterId: cl.id, status: 'review-needed' });
    const r = await runTriage(prId);
    expect(r).toEqual({ kind: 'skipped', reason: 'in-cluster' });
  });

  it('upserts triage_decision (re-running replaces previous row)', async () => {
    const prId = setupPR({ confidence: 95 });
    await runTriage(prId);

    // PreReview 수정 — 차단 플래그 추가
    db.update(preReviews)
      .set({ flags: ['migration'] })
      .where(eq(preReviews.prId, prId))
      .run();

    await runTriage(prId);

    const rows = db.select().from(triageDecisions).where(eq(triageDecisions.prId, prId)).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].decision).toBe('human-review');
    expect(rows[0].reason).toContain('마이그레이션');
  });
});
