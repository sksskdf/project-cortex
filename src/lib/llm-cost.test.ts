import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/client';
import { llmUsage } from '@/db/schema';
import { getLlmCostSummary, recordLlmUsage } from './llm-cost';

beforeAll(() => {
  migrate(db, { migrationsFolder: 'src/db/migrations' });
});

beforeEach(() => {
  db.delete(llmUsage).run();
});

describe('recordLlmUsage / getLlmCostSummary', () => {
  it('빈 상태는 0', () => {
    expect(getLlmCostSummary()).toEqual({
      totalCostUsd: 0,
      callCount: 0,
      weekCostUsd: 0,
      byModel: [],
    });
  });

  it('비용·호출 수를 누적하고 모델별로 집계(비용 큰 순)', () => {
    recordLlmUsage('claude-opus-4-7', { costUsd: 0.05, inputTokens: 1000, outputTokens: 200 });
    recordLlmUsage('claude-opus-4-7', { costUsd: 0.03, inputTokens: 800, outputTokens: 100 });
    recordLlmUsage('claude-haiku-4-5', { costUsd: 0.001, inputTokens: 500, outputTokens: 50 });

    const s = getLlmCostSummary();
    expect(s.callCount).toBe(3);
    expect(s.totalCostUsd).toBeCloseTo(0.081, 5);
    expect(s.weekCostUsd).toBeCloseTo(0.081, 5);
    // 비용 큰 순 — opus 먼저.
    expect(s.byModel[0].model).toBe('claude-opus-4-7');
    expect(s.byModel[0].calls).toBe(2);
    expect(s.byModel[0].costUsd).toBeCloseTo(0.08, 5);
    expect(s.byModel[1].model).toBe('claude-haiku-4-5');
  });

  it('비용 null(봉투에 없음)도 호출 수엔 집계, 비용 합엔 0 취급', () => {
    recordLlmUsage(null, { costUsd: null, inputTokens: null, outputTokens: null });
    const s = getLlmCostSummary();
    expect(s.callCount).toBe(1);
    expect(s.totalCostUsd).toBe(0);
    expect(s.byModel[0].model).toBe('(미상)');
  });

  it('7일보다 오래된 기록은 weekCostUsd 에서 제외(누적엔 포함)', () => {
    recordLlmUsage('m', { costUsd: 0.02, inputTokens: 1, outputTokens: 1 });
    // 8일 전 기록 직접 삽입.
    db.insert(llmUsage)
      .values({
        model: 'm',
        costUsd: 0.1,
        inputTokens: 1,
        outputTokens: 1,
        createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
      })
      .run();

    const s = getLlmCostSummary();
    expect(s.totalCostUsd).toBeCloseTo(0.12, 5);
    expect(s.weekCostUsd).toBeCloseTo(0.02, 5);
  });
});
