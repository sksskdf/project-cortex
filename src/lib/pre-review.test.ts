import type Anthropic from '@anthropic-ai/sdk';
import type { Octokit } from '@octokit/rest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/client';
import { preReviews, prs, projects, triageDecisions } from '@/db/schema';
import { setAnthropic } from './anthropic';
import { setOctokit } from './github';
import { analyzePR, extractPaths } from './pre-review';

function makeAnthropic(response: unknown): Anthropic {
  return { messages: { create: vi.fn().mockResolvedValue(response) } } as unknown as Anthropic;
}

function makeOctokitWithDiff(diff: string): Octokit {
  return {
    pulls: { get: vi.fn().mockResolvedValue({ data: diff }), merge: vi.fn() },
  } as unknown as Octokit;
}

function llmResponse(payload: Record<string, unknown>) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
  };
}

beforeAll(() => {
  migrate(db, { migrationsFolder: 'src/db/migrations' });
});

beforeEach(() => {
  db.delete(triageDecisions).run();
  db.delete(preReviews).run();
  db.delete(prs).run();
  db.delete(projects).run();
});

afterEach(() => {
  setAnthropic(null);
  setOctokit(null);
});

function setupPR(opts: {
  slug?: string;
  headSha?: string;
  authorKind?: 'agent' | 'human';
  linesAdded?: number;
  linesRemoved?: number;
  filesChanged?: number;
}) {
  const project = db
    .insert(projects)
    .values({ slug: opts.slug ?? 'acme/web', name: 'Web', autoMergeEnabled: true })
    .returning({ id: projects.id })
    .get();
  const pr = db
    .insert(prs)
    .values({
      repoId: project.id,
      number: 42,
      title: 'Add greeting',
      authorKind: opts.authorKind ?? 'agent',
      authorId: 'devin',
      headSha: opts.headSha ?? 'sha-abc',
      linesAdded: opts.linesAdded ?? 10,
      linesRemoved: opts.linesRemoved ?? 2,
      filesChanged: opts.filesChanged ?? 1,
      status: 'open',
    })
    .returning({ id: prs.id })
    .get();
  return pr.id;
}

describe('extractPaths', () => {
  it('pulls b-side paths from diff --git headers', () => {
    const diff = [
      'diff --git a/src/foo.ts b/src/foo.ts',
      'index 0..1 100644',
      '--- a/src/foo.ts',
      '+++ b/src/foo.ts',
      '@@ -1 +1 @@',
      '+ const x = 1;',
      'diff --git a/src/bar.ts b/src/bar.ts',
      '+ const y = 2;',
    ].join('\n');
    expect(extractPaths(diff).sort()).toEqual(['src/bar.ts', 'src/foo.ts']);
  });

  it('returns empty array when no diff headers', () => {
    expect(extractPaths('+ random content\n+ no header')).toEqual([]);
  });
});

describe('analyzePR', () => {
  it('skips when PR does not exist', async () => {
    const r = await analyzePR(9999);
    expect(r).toEqual({ kind: 'skipped', reason: 'no-pr' });
  });

  it('calls Anthropic, stores result with combined flags', async () => {
    const diff =
      'diff --git a/src/payment/refund.ts b/src/payment/refund.ts\n+ const r = await fetch("https://api.stripe.com");';
    setOctokit(makeOctokitWithDiff(diff));
    const anthropic = makeAnthropic(
      llmResponse({
        confidence: 75,
        flags: ['payment-domain'],
        summary: '환불 로직에 새 외부 호출 추가.',
        comments: [{ path: 'src/payment/refund.ts', line: 1, body: '에러 처리 필요' }],
        hunkAnnotations: [{ hunkId: 'src/payment/refund.ts:1', decision: 'review' }],
      }),
    );
    setAnthropic(anthropic);

    const prId = setupPR({});
    const r = await analyzePR(prId);

    expect(r.kind).toBe('analyzed');
    if (r.kind !== 'analyzed') return;
    expect(r.row.confidence).toBe(75);
    expect(r.row.confidenceTier).toBe('medium');
    // 휴리스틱이 external-api-new 도 잡아서 union 결과.
    expect([...r.row.flags].sort()).toEqual(['external-api-new', 'payment-domain']);
    expect(r.row.summary).toBe('환불 로직에 새 외부 호출 추가.');
    expect(r.row.comments).toHaveLength(1);
    expect(r.row.hunkAnnotations).toHaveLength(1);
    expect(r.row.testsPassed).toBeNull();
  });

  it('returns cached row on second call without calling Anthropic', async () => {
    const diff = 'diff --git a/src/x.ts b/src/x.ts\n+ const x = 1;';
    setOctokit(makeOctokitWithDiff(diff));
    const createMock = vi.fn().mockResolvedValue(
      llmResponse({
        confidence: 95,
        flags: [],
        summary: '단순 변경.',
        comments: [],
        hunkAnnotations: [],
      }),
    );
    setAnthropic({ messages: { create: createMock } } as unknown as Anthropic);

    const prId = setupPR({});
    const first = await analyzePR(prId);
    expect(first.kind).toBe('analyzed');
    expect(createMock).toHaveBeenCalledTimes(1);

    const second = await analyzePR(prId);
    expect(second.kind).toBe('cached');
    expect(createMock).toHaveBeenCalledTimes(1);
    if (second.kind === 'cached') {
      expect(second.row.confidence).toBe(95);
    }
  });

  it('rejects responses that fail schema validation', async () => {
    setOctokit(makeOctokitWithDiff('diff --git a/x b/x\n+ y'));
    setAnthropic(
      makeAnthropic(
        llmResponse({
          confidence: 200, // 0-100 범위 위반
          flags: [],
          summary: 'x',
          comments: [],
          hunkAnnotations: [],
        }),
      ),
    );
    await expect(analyzePR(setupPR({}))).rejects.toThrow();
  });

  it('rejects responses with unknown flag enum values', async () => {
    setOctokit(makeOctokitWithDiff('diff --git a/x b/x\n+ y'));
    setAnthropic(
      makeAnthropic(
        llmResponse({
          confidence: 50,
          flags: ['nuclear-codes'],
          summary: 'x',
          comments: [],
          hunkAnnotations: [],
        }),
      ),
    );
    await expect(analyzePR(setupPR({}))).rejects.toThrow();
  });

  it('uses Opus 4.7 model with adaptive thinking and JSON schema output_config', async () => {
    setOctokit(makeOctokitWithDiff('diff --git a/x b/x\n+ y'));
    const createMock = vi.fn().mockResolvedValue(
      llmResponse({
        confidence: 80,
        flags: [],
        summary: 'ok',
        comments: [],
        hunkAnnotations: [],
      }),
    );
    setAnthropic({ messages: { create: createMock } } as unknown as Anthropic);

    await analyzePR(setupPR({}));

    expect(createMock).toHaveBeenCalledTimes(1);
    const arg = createMock.mock.calls[0][0];
    expect(arg.model).toBe('claude-opus-4-7');
    expect(arg.thinking).toEqual({ type: 'adaptive' });
    expect(arg.output_config.format.type).toBe('json_schema');
    expect(arg.output_config.effort).toBe('high');
    // system은 cache_control 가 박힌 TextBlockParam 배열.
    expect(Array.isArray(arg.system)).toBe(true);
    expect(arg.system[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('persists confidence-tier based on returned score', async () => {
    setOctokit(makeOctokitWithDiff('diff --git a/x b/x\n+ y'));
    setAnthropic(
      makeAnthropic(
        llmResponse({
          confidence: 92,
          flags: [],
          summary: 'high tier',
          comments: [],
          hunkAnnotations: [],
        }),
      ),
    );

    const prId = setupPR({});
    await analyzePR(prId);
    const row = db.select().from(preReviews).where(eq(preReviews.prId, prId)).get();
    expect(row?.confidenceTier).toBe('high');
  });
});
