import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/client';
import { preReviews, prs, projects, triageDecisions } from '@/db/schema';
import { getPRDetail } from './pr';

beforeAll(() => {
  migrate(db, { migrationsFolder: 'src/db/migrations' });
});

beforeEach(() => {
  db.delete(triageDecisions).run();
  db.delete(preReviews).run();
  db.delete(prs).run();
  db.delete(projects).run();
});

function setup(opts: {
  withPreReview?: boolean;
  withTriage?: boolean;
  confidence?: number;
  flags?: string[];
  summary?: string | null;
  testsPassed?: boolean | null;
  coverage?: number | null;
  comments?: { path: string; line: number; body: string }[];
  hunkAnnotations?: { hunkId: string; decision: 'auto' | 'review'; reason?: string }[];
  changedPaths?: string[];
}) {
  const project = db
    .insert(projects)
    .values({ slug: 'acme/web', name: 'Web', installationId: 1 })
    .returning({ id: projects.id })
    .get();
  const pr = db
    .insert(prs)
    .values({
      repoId: project.id,
      number: 42,
      title: 'Test PR',
      authorKind: 'agent',
      authorId: 'devin',
      headSha: 'sha-x',
      linesAdded: 30,
      linesRemoved: 5,
      filesChanged: 3,
      status: 'review-needed',
    })
    .returning({ id: prs.id })
    .get();

  if (opts.withPreReview) {
    db.insert(preReviews)
      .values({
        prId: pr.id,
        headSha: 'sha-x',
        confidence: opts.confidence ?? 75,
        confidenceTier: 'medium',
        flags: opts.flags ?? [],
        changedPaths: opts.changedPaths ?? ['src/a.ts', 'src/b.ts'],
        hunkAnnotations: opts.hunkAnnotations ?? null,
        summary: opts.summary ?? null,
        comments: opts.comments ?? null,
        testsPassed: opts.testsPassed ?? null,
        coverage: opts.coverage ?? null,
      })
      .run();
  }

  if (opts.withTriage) {
    db.insert(triageDecisions)
      .values({
        prId: pr.id,
        decision: 'human-review',
        reason: 'tests not run',
        decidedBy: 'system',
      })
      .run();
  }

  return `pr-${pr.id}`;
}

describe('getPRDetail', () => {
  it('returns null for unknown id format', async () => {
    expect(await getPRDetail('xxx')).toBeNull();
    expect(await getPRDetail('pr-9999')).toBeNull();
  });

  it('uses fixture when preReview is missing', async () => {
    const id = setup({});
    const view = await getPRDetail(id);
    expect(view?.source).toBe('fixture');
    // fixture 의 hunkSummary 가 그대로 노출 (17 hunks, 14 auto-approvable).
    expect(view?.hunkSummary.totalHunks).toBe(17);
  });

  // 시드 PR 케이스 — preReview 행은 있지만 changedPaths · parsedFiles · comments ·
  // hunkAnnotations 가 모두 비어 있어 트리/diff 가 그려지지 않음. fixture 로 폴백 + 배너.
  it('uses fixture when preReview exists but diff columns are all empty', async () => {
    const id = setup({ withPreReview: true, changedPaths: [] });
    const view = await getPRDetail(id);
    expect(view?.source).toBe('fixture');
    expect(view?.hunkSummary.totalHunks).toBe(17);
  });

  it('builds aiSummary from real preReview when available', async () => {
    const id = setup({
      withPreReview: true,
      summary: 'Anthropic 응답 요약',
      flags: ['payment-domain'],
      testsPassed: false,
      coverage: 0.55,
    });
    const view = await getPRDetail(id);
    expect(view?.source).toBe('analyzed');
    expect(view?.fixture.aiSummary.summarySegments[0].text).toBe('Anthropic 응답 요약');
    const checks = view!.fixture.aiSummary.checks;
    expect(checks.find((c) => c.key === 'tests')?.value).toBe('실패');
    expect(checks.find((c) => c.key === 'tests')?.tone).toBe('alert');
    expect(checks.find((c) => c.key === 'coverage')?.value).toContain('55%');
    expect(checks.find((c) => c.key === 'coverage')?.tone).toBe('warn');
    expect(checks.find((c) => c.key === 'risk')?.value).toBe('payment-domain');
    expect(checks.find((c) => c.key === 'risk')?.tone).toBe('alert');
  });

  it('builds tree from changedPaths and hunkAnnotations', async () => {
    const id = setup({
      withPreReview: true,
      changedPaths: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
      hunkAnnotations: [
        { hunkId: 'src/a.ts:10', decision: 'review', reason: 'check' },
        { hunkId: 'src/b.ts:5', decision: 'auto' },
      ],
    });
    const view = await getPRDetail(id);
    const tree = view!.fixture.tree;
    const needsReview = tree.find((g) => g.groupKey === 'needsReview');
    const auto = tree.find((g) => g.groupKey === 'autoApprovable');
    expect(needsReview?.files.map((f) => f.path)).toEqual(['src/a.ts']);
    // c.ts 는 annotation 없음 → auto 그룹으로 분류.
    expect(auto?.files.map((f) => f.path).sort()).toEqual(['src/b.ts', 'src/c.ts']);
    expect(view?.hunkSummary.totalHunks).toBe(2);
    expect(view?.hunkSummary.autoApprovableHunks).toBe(1);
  });

  it('builds files block from real comments grouped by path', async () => {
    const id = setup({
      withPreReview: true,
      changedPaths: ['src/a.ts', 'src/b.ts'],
      comments: [
        { path: 'src/a.ts', line: 42, body: '에러 처리 누락' },
        { path: 'src/a.ts', line: 50, body: '타입 좁히기' },
      ],
    });
    const view = await getPRDetail(id);
    const fileA = view!.fixture.files.find((f) => f.path === 'src/a.ts');
    expect(fileA?.hunks).toHaveLength(2);
    expect(fileA?.status).toBe('warn');

    // b.ts 는 코멘트 없음 → collapsed 한 개 + status ok.
    const fileB = view!.fixture.files.find((f) => f.path === 'src/b.ts');
    expect(fileB?.status).toBe('ok');
    expect(fileB?.hunks).toHaveLength(1);
  });

  it('shows triage reason on the PR object', async () => {
    const id = setup({ withPreReview: true, withTriage: true });
    const view = await getPRDetail(id);
    expect(view?.pr.reason.text).toBe('tests not run');
  });

  it('defaults coverage and tests checks when fields are null', async () => {
    const id = setup({ withPreReview: true });
    const view = await getPRDetail(id);
    const checks = view!.fixture.aiSummary.checks;
    expect(checks.find((c) => c.key === 'tests')?.value).toBe('미측정');
    expect(checks.find((c) => c.key === 'coverage')?.value).toBe('미측정');
  });

  // 변경 요청 가능 여부 게이팅 — Cortex 는 AI 코드의 게이트키퍼라 위험 분류된
  // PR (reason.tone alert/warn) 에서만 사람의 거절 의사가 의미 있음.
  it('canRequestChanges is true on alert PR (blocking flag)', async () => {
    const id = setup({
      withPreReview: true,
      withTriage: true,
      confidence: 92,
      flags: ['payment-domain'],
    });
    const view = await getPRDetail(id);
    expect(view?.canRequestChanges).toBe(true);
  });

  it('canRequestChanges is true on warn PR (confidence < 70)', async () => {
    const id = setup({
      withPreReview: true,
      withTriage: true,
      confidence: 55,
      flags: [],
    });
    const view = await getPRDetail(id);
    expect(view?.canRequestChanges).toBe(true);
  });

  it('canRequestChanges is false on safe PR (high confidence, no flags)', async () => {
    const id = setup({
      withPreReview: true,
      withTriage: true,
      confidence: 95,
      flags: [],
    });
    const view = await getPRDetail(id);
    expect(view?.canRequestChanges).toBe(false);
  });

  it('canRequestChanges is false when triage missing (tone falls back to info)', async () => {
    const id = setup({ withPreReview: true, confidence: 30, flags: ['migration'] });
    const view = await getPRDetail(id);
    expect(view?.canRequestChanges).toBe(false);
  });
});
