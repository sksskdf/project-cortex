import type { Octokit } from '@octokit/rest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/client';
import { appSettings, preReviews, prs, projects, triageDecisions } from '@/db/schema';
import { setClaudeRunner } from './claude-cli';
import { setOctokit } from './github';
import { analyzePR, extractPaths } from './pre-review';

// 모든 LLM 호출은 claude CLI 경로 — runClaudeHeadless 를 setClaudeRunner 로 주입한다.
// CLI 응답은 { ok: true, text: '<JSON 문자열>' } 형태.
function makeRunner(payload: Record<string, unknown>) {
  return vi.fn().mockResolvedValue({ ok: true, text: JSON.stringify(payload) });
}

function makeOctokitWithDiff(diff: string): Octokit {
  return {
    pulls: { get: vi.fn().mockResolvedValue({ data: diff }), merge: vi.fn() },
  } as unknown as Octokit;
}

beforeAll(() => {
  migrate(db, { migrationsFolder: 'src/db/migrations' });
});

beforeEach(() => {
  db.delete(triageDecisions).run();
  db.delete(preReviews).run();
  db.delete(prs).run();
  db.delete(projects).run();
  db.delete(appSettings).run();
});

afterEach(() => {
  setOctokit(null);
  setClaudeRunner(null);
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
    .values({
      slug: opts.slug ?? 'acme/web',
      name: 'Web',
      autoMergeEnabled: true,
      installationId: 12345,
    })
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

describe('analyzePR (claude CLI)', () => {
  it('skips when PR does not exist', async () => {
    const r = await analyzePR(9999);
    expect(r).toEqual({ kind: 'skipped', reason: 'no-pr' });
  });

  it('claude CLI 를 호출하고 결과를 휴리스틱 플래그와 합쳐 저장', async () => {
    const diff =
      'diff --git a/src/payment/refund.ts b/src/payment/refund.ts\n+ const r = await fetch("https://api.stripe.com");';
    setOctokit(makeOctokitWithDiff(diff));
    const runner = makeRunner({
      confidence: 75,
      flags: ['payment-domain'],
      summary: '환불 로직에 새 외부 호출 추가.',
      comments: [{ path: 'src/payment/refund.ts', line: 1, body: '에러 처리 필요' }],
      hunkAnnotations: [{ hunkId: 'src/payment/refund.ts:1', decision: 'review' }],
    });
    setClaudeRunner(runner);

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
    // 사용자 Claude 플랜 모델로 호출 (크레딧 0).
    expect(runner.mock.calls[0][0].model).toBe('claude-opus-4-7');
  });

  it('R1 — 메인 호출에 jsonSchema 를 전달', async () => {
    const diff = 'diff --git a/src/x.ts b/src/x.ts\n+ const x = 1;';
    setOctokit(makeOctokitWithDiff(diff));
    const runner = makeRunner({
      confidence: 90,
      flags: [],
      summary: 'ok',
      comments: [],
      hunkAnnotations: [],
    });
    setClaudeRunner(runner);

    await analyzePR(setupPR({}));

    const arg = runner.mock.calls[0][0];
    expect(arg.jsonSchema).toBeDefined();
    // llmResultJsonSchema 의 핵심 필드가 들어있는지(triage 가 아니라 메인 스키마).
    expect(arg.jsonSchema.properties.hunkAnnotations).toBeDefined();
    expect(arg.jsonSchema.required).toContain('confidence');
  });

  it('Phase 20 — whatToCheck 를 저장 (사용자 확인 체크포인트)', async () => {
    const diff = 'diff --git a/src/x.ts b/src/x.ts\n+ const x = 1;';
    setOctokit(makeOctokitWithDiff(diff));
    setClaudeRunner(
      makeRunner({
        confidence: 72,
        flags: [],
        summary: '변경 요약.',
        whatToCheck: ['마이그레이션 후 기존 데이터 정상 동작 확인', '엣지 케이스 X 동작'],
        comments: [],
        hunkAnnotations: [],
      }),
    );

    const r = await analyzePR(setupPR({}));
    expect(r.kind).toBe('analyzed');
    if (r.kind !== 'analyzed') return;
    expect(r.row.whatToCheck).toEqual([
      '마이그레이션 후 기존 데이터 정상 동작 확인',
      '엣지 케이스 X 동작',
    ]);
  });

  it('Phase 20 — whatToCheck 누락 시 빈 배열로 기본값(legacy/단순)', async () => {
    const diff = 'diff --git a/src/x.ts b/src/x.ts\n+ const x = 1;';
    setOctokit(makeOctokitWithDiff(diff));
    // whatToCheck 없는 페이로드 — zod .default([]) 로 빈 배열.
    setClaudeRunner(
      makeRunner({ confidence: 95, flags: [], summary: 'ok', comments: [], hunkAnnotations: [] }),
    );

    const r = await analyzePR(setupPR({}));
    expect(r.kind).toBe('analyzed');
    if (r.kind !== 'analyzed') return;
    expect(r.row.whatToCheck).toEqual([]);
  });

  it('R1 — structured_output 가 있으면 텍스트 파싱 대신 그것을 사용', async () => {
    const diff = 'diff --git a/src/x.ts b/src/x.ts\n+ const x = 1;';
    setOctokit(makeOctokitWithDiff(diff));
    // text 는 파싱 불가한 산문 — structured 를 안 쓰면 throw → analyzed 실패.
    setClaudeRunner(
      vi.fn().mockResolvedValue({
        ok: true,
        text: '분석 결과를 정리하면 다음과 같습니다 (JSON 아님).',
        structured: {
          confidence: 88,
          flags: [],
          summary: 'structured 경로',
          comments: [],
          hunkAnnotations: [],
        },
      }),
    );

    const r = await analyzePR(setupPR({}));
    expect(r.kind).toBe('analyzed');
    if (r.kind !== 'analyzed') return;
    expect(r.row.confidence).toBe(88);
    expect(r.row.summary).toBe('structured 경로');
  });

  it('두 번째 호출은 캐시 반환 — claude CLI 재호출 안 함', async () => {
    const diff = 'diff --git a/src/x.ts b/src/x.ts\n+ const x = 1;';
    setOctokit(makeOctokitWithDiff(diff));
    const runner = makeRunner({
      confidence: 95,
      flags: [],
      summary: '단순 변경.',
      comments: [],
      hunkAnnotations: [],
    });
    setClaudeRunner(runner);

    const prId = setupPR({});
    const first = await analyzePR(prId);
    expect(first.kind).toBe('analyzed');
    expect(runner).toHaveBeenCalledTimes(1);

    const second = await analyzePR(prId);
    expect(second.kind).toBe('cached');
    expect(runner).toHaveBeenCalledTimes(1);
    if (second.kind === 'cached') {
      expect(second.row.confidence).toBe(95);
    }
  });

  it('스키마 검증 실패 응답은 reject', async () => {
    setOctokit(makeOctokitWithDiff('diff --git a/x b/x\n+ y'));
    setClaudeRunner(
      makeRunner({
        confidence: 200, // 0-100 범위 위반
        flags: [],
        summary: 'x',
        comments: [],
        hunkAnnotations: [],
      }),
    );
    await expect(analyzePR(setupPR({}))).rejects.toThrow();
  });

  it('알 수 없는 flag enum 값 응답은 reject', async () => {
    setOctokit(makeOctokitWithDiff('diff --git a/x b/x\n+ y'));
    setClaudeRunner(
      makeRunner({
        confidence: 50,
        flags: ['nuclear-codes'],
        summary: 'x',
        comments: [],
        hunkAnnotations: [],
      }),
    );
    await expect(analyzePR(setupPR({}))).rejects.toThrow();
  });

  it('코드펜스로 감싼 JSON 응답도 파싱', async () => {
    setOctokit(makeOctokitWithDiff('diff --git a/x b/x\n+ y'));
    setClaudeRunner(
      vi.fn().mockResolvedValue({
        ok: true,
        text: '```json\n{"confidence":91,"flags":[],"summary":"ok","comments":[],"hunkAnnotations":[]}\n```',
      }),
    );

    const r = await analyzePR(setupPR({}));
    expect(r.kind).toBe('analyzed');
    if (r.kind === 'analyzed') expect(r.row.confidenceTier).toBe('high');
  });

  it('CLI 실패(ok:false)면 throw — sync 의 safeAnalyze 가 잡아 폴백', async () => {
    setOctokit(makeOctokitWithDiff('diff --git a/x b/x\n+ y'));
    setClaudeRunner(
      vi.fn().mockResolvedValue({ ok: false, reason: 'claude CLI 를 찾을 수 없습니다.' }),
    );
    await expect(analyzePR(setupPR({}))).rejects.toThrow();
  });

  it('Opus 4.7 모델로 호출하고 도구 권한은 주지 않음 (분석 전용)', async () => {
    setOctokit(makeOctokitWithDiff('diff --git a/x b/x\n+ y'));
    const runner = makeRunner({
      confidence: 80,
      flags: [],
      summary: 'ok',
      comments: [],
      hunkAnnotations: [],
    });
    setClaudeRunner(runner);

    await analyzePR(setupPR({}));

    expect(runner).toHaveBeenCalledTimes(1);
    const arg = runner.mock.calls[0][0];
    expect(arg.model).toBe('claude-opus-4-7');
    // 사전 리뷰는 분석만 — 파일 편집/도구 권한 없음 (충돌 해결·테스트 수정과 다름).
    expect(arg.dangerouslyAllowAllTools).toBeFalsy();
    expect(arg.cwd).toBeUndefined();
  });

  it('반환 점수 기준으로 confidence-tier 저장', async () => {
    setOctokit(makeOctokitWithDiff('diff --git a/x b/x\n+ y'));
    setClaudeRunner(
      makeRunner({
        confidence: 92,
        flags: [],
        summary: 'high tier',
        comments: [],
        hunkAnnotations: [],
      }),
    );

    const prId = setupPR({});
    await analyzePR(prId);
    const row = db.select().from(preReviews).where(eq(preReviews.prId, prId)).get();
    expect(row?.confidenceTier).toBe('high');
  });

  it('settings.aiEnabled=false 면 ai-disabled 로 skip — claude 호출 0', async () => {
    db.insert(appSettings).values({ id: 1, aiEnabled: false }).run();
    const runner = vi.fn();
    setClaudeRunner(runner);
    setOctokit(makeOctokitWithDiff('diff --git a/x b/x\n+ y'));

    const r = await analyzePR(setupPR({}));
    expect(r).toEqual({ kind: 'skipped', reason: 'ai-disabled' });
    expect(runner).not.toHaveBeenCalled();
  });
});

describe('analyzePR — Phase 4.5b triage (CORTEX_TRIAGE_ENABLED=1)', () => {
  // env.triageEnabled() 가 process.env 를 매번 lazy 평가하므로 set/restore 로 토글.
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.CORTEX_TRIAGE_ENABLED;
    process.env.CORTEX_TRIAGE_ENABLED = '1';
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.CORTEX_TRIAGE_ENABLED;
    else process.env.CORTEX_TRIAGE_ENABLED = originalEnv;
  });

  // triage(1차) → deep(2차) 두 단계 응답을 순서대로 돌려주는 runner.
  function makeTwoStepRunner(triagePayload: unknown, deepPayload: unknown) {
    const runner = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, text: JSON.stringify(triagePayload) })
      .mockResolvedValueOnce({ ok: true, text: JSON.stringify(deepPayload) });
    return runner;
  }

  it('단순 PR (needsDeepReview=false + flags 비어있음 + confidence>=80) → Opus 호출 안 함', async () => {
    setOctokit(makeOctokitWithDiff('diff --git a/src/x.ts b/src/x.ts\n+ const x = 1;'));
    const runner = makeTwoStepRunner(
      { needsDeepReview: false, confidence: 90, flagCandidates: [], summary: '단순 변수 추가.' },
      // Opus 호출되면 안 되지만 안전망.
      {
        confidence: 50,
        flags: [],
        summary: 'should-not-be-used',
        comments: [],
        hunkAnnotations: [],
      },
    );
    setClaudeRunner(runner);

    const prId = setupPR({});
    const r = await analyzePR(prId);

    expect(r.kind).toBe('analyzed');
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner.mock.calls[0][0].model).toBe('claude-haiku-4-5-20251001');
    if (r.kind !== 'analyzed') return;
    expect(r.row.confidence).toBe(90);
    expect(r.row.summary).toBe('단순 변수 추가.');
    expect(r.row.comments).toEqual([]);
  });

  it('복잡 PR (needsDeepReview=true) → Opus 로 재호출 + 그 결과 사용', async () => {
    setOctokit(
      makeOctokitWithDiff(
        'diff --git a/src/payment/refund.ts b/src/payment/refund.ts\n+ const x = 1;',
      ),
    );
    const runner = makeTwoStepRunner(
      {
        needsDeepReview: true,
        confidence: 60,
        flagCandidates: ['payment-domain'],
        summary: '결제 영역 의심.',
      },
      {
        confidence: 55,
        flags: ['payment-domain'],
        summary: '결제 영역 환불 로직 변경.',
        comments: [{ path: 'src/payment/refund.ts', line: 1, body: '검토 필요' }],
        hunkAnnotations: [{ hunkId: 'src/payment/refund.ts:1', decision: 'review' }],
      },
    );
    setClaudeRunner(runner);

    const r = await analyzePR(setupPR({}));

    expect(r.kind).toBe('analyzed');
    expect(runner).toHaveBeenCalledTimes(2);
    expect(runner.mock.calls[0][0].model).toBe('claude-haiku-4-5-20251001');
    expect(runner.mock.calls[1][0].model).toBe('claude-opus-4-7');
    if (r.kind !== 'analyzed') return;
    // Opus 결과 사용.
    expect(r.row.confidence).toBe(55);
    expect(r.row.summary).toBe('결제 영역 환불 로직 변경.');
    expect(r.row.comments).toHaveLength(1);
  });

  it('triage confidence<80 면 단순 조건 안 되므로 Opus 재호출', async () => {
    setOctokit(makeOctokitWithDiff('diff --git a/src/x.ts b/src/x.ts\n+ const x = 1;'));
    const runner = makeTwoStepRunner(
      { needsDeepReview: false, confidence: 70, flagCandidates: [], summary: '확신 부족.' },
      { confidence: 75, flags: [], summary: 'opus 결과.', comments: [], hunkAnnotations: [] },
    );
    setClaudeRunner(runner);

    const r = await analyzePR(setupPR({}));
    expect(runner).toHaveBeenCalledTimes(2);
    if (r.kind === 'analyzed') expect(r.row.confidence).toBe(75);
  });

  it('triage 호출이 실패하면 Opus 로 안전 폴백', async () => {
    setOctokit(makeOctokitWithDiff('diff --git a/src/x.ts b/src/x.ts\n+ const x = 1;'));
    const runner = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, reason: 'haiku rate limit' })
      .mockResolvedValueOnce({
        ok: true,
        text: JSON.stringify({
          confidence: 85,
          flags: [],
          summary: 'opus fallback ok.',
          comments: [],
          hunkAnnotations: [],
        }),
      });
    setClaudeRunner(runner);

    const r = await analyzePR(setupPR({}));
    expect(r.kind).toBe('analyzed');
    expect(runner).toHaveBeenCalledTimes(2);
    if (r.kind === 'analyzed') expect(r.row.summary).toBe('opus fallback ok.');
  });
});
