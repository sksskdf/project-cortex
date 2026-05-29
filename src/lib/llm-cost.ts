// Phase 13.6 R3 — 헤드리스 claude 호출 비용·토큰 기록 + 집계. 2026-06-15 부터 구독 플랜
// claude -p 가 별도 Agent SDK 크레딧을 소모하므로 호출별 비용을 누적·관측한다(/reports).

import { gte, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { llmUsage } from '@/db/schema';
import type { ClaudeUsage } from './claude-cli';

// runClaudeHeadless 성공 시 호출. best-effort — 기록 실패가 호출 흐름을 막지 않게 호출부에서 감쌈.
export function recordLlmUsage(model: string | null, usage: ClaudeUsage): void {
  db.insert(llmUsage)
    .values({
      model,
      costUsd: usage.costUsd,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    })
    .run();
}

export type LlmCostSummary = {
  // 전체 누적.
  totalCostUsd: number;
  callCount: number;
  // 최근 7일 비용.
  weekCostUsd: number;
  // 모델별 비용 (비용 큰 순).
  byModel: ReadonlyArray<{ model: string; costUsd: number; calls: number }>;
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function getLlmCostSummary(): LlmCostSummary {
  const totals = db
    .select({
      cost: sql<number>`coalesce(sum(${llmUsage.costUsd}), 0)`,
      calls: sql<number>`count(*)`,
    })
    .from(llmUsage)
    .get();

  const weekAgo = new Date(Date.now() - WEEK_MS);
  const week = db
    .select({ cost: sql<number>`coalesce(sum(${llmUsage.costUsd}), 0)` })
    .from(llmUsage)
    .where(gte(llmUsage.createdAt, weekAgo))
    .get();

  const byModelRows = db
    .select({
      model: llmUsage.model,
      cost: sql<number>`coalesce(sum(${llmUsage.costUsd}), 0)`,
      calls: sql<number>`count(*)`,
    })
    .from(llmUsage)
    .groupBy(llmUsage.model)
    .all();

  const byModel = byModelRows
    .map((r) => ({ model: r.model ?? '(미상)', costUsd: r.cost, calls: r.calls }))
    .sort((a, b) => b.costUsd - a.costUsd);

  return {
    totalCostUsd: totals?.cost ?? 0,
    callCount: totals?.calls ?? 0,
    weekCostUsd: week?.cost ?? 0,
    byModel,
  };
}
