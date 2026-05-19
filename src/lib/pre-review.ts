// Phase 4.2 — PR을 받아 Anthropic 분석을 돌리고 pre_reviews 행을 만든다.
// 캐싱: (prId, headSha) 유니크 인덱스가 잡혀 있어 같은 SHA면 기존 행을 반환.
// LLM 결과의 flags는 휴리스틱(lib/risk-flags) 결과와 union — LLM이 놓친 신호도 잡힘.

import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { preReviews, prs, projects } from '@/db/schema';
import type { PreReviewRow } from '@/db/schema';
import { getAnthropic, PRE_REVIEW_MODEL } from './anthropic';
import { confidenceTier } from './confidence';
import { getPRDiff } from './github';
import {
  buildPreReviewUserPrompt,
  PRE_REVIEW_OUTPUT_SCHEMA,
  PRE_REVIEW_SYSTEM_PROMPT,
  RISK_FLAGS,
} from './prompts/pre-review';
import { precomputeFlags } from './risk-flags';
import type { RiskFlag } from './types';

// 결과 schema — Anthropic 응답을 JSON.parse 한 직후 검증.
const llmResultSchema = z.object({
  confidence: z.number().int().min(0).max(100),
  flags: z.array(z.enum(RISK_FLAGS as readonly [RiskFlag, ...RiskFlag[]])),
  summary: z.string(),
  comments: z.array(
    z.object({
      path: z.string(),
      line: z.number().int().min(1),
      body: z.string(),
    }),
  ),
  hunkAnnotations: z.array(
    z.object({
      hunkId: z.string(),
      decision: z.enum(['auto', 'review']),
      reason: z.string().optional(),
    }),
  ),
});

export type AnalyzeResult =
  | { kind: 'cached'; row: PreReviewRow }
  | { kind: 'analyzed'; row: PreReviewRow }
  | { kind: 'skipped'; reason: 'no-pr' | 'no-project' | 'no-installation' };

// diff가 너무 크면 토큰 폭발 — 50KB 제한. 잘릴 때 LLM이 인지하도록 표시.
const MAX_DIFF_CHARS = 50_000;

function clampDiff(diff: string): string {
  if (diff.length <= MAX_DIFF_CHARS) return diff;
  return `${diff.slice(0, MAX_DIFF_CHARS)}\n\n... (diff truncated: original ${diff.length} chars)`;
}

export async function analyzePR(prId: number): Promise<AnalyzeResult> {
  const pr = db.select().from(prs).where(eq(prs.id, prId)).get();
  if (!pr) return { kind: 'skipped', reason: 'no-pr' };

  const project = db.select().from(projects).where(eq(projects.id, pr.repoId)).get();
  if (!project) return { kind: 'skipped', reason: 'no-project' };

  // 캐시 hit — 같은 (prId, headSha)면 LLM 호출 안 함.
  const cached = db
    .select()
    .from(preReviews)
    .where(and(eq(preReviews.prId, prId), eq(preReviews.headSha, pr.headSha)))
    .get();
  if (cached) return { kind: 'cached', row: cached };

  // GitHub App 토큰을 발급받으려면 installation 이 등록돼 있어야 함.
  // seed 데이터처럼 null 인 프로젝트는 분석 대상 아님.
  if (project.installationId === null) {
    return { kind: 'skipped', reason: 'no-installation' };
  }

  const [owner, repo] = project.slug.split('/');
  const diff = await getPRDiff(project.installationId, { owner, repo }, pr.number);
  const changedPaths = extractPaths(diff);

  const heuristicFlags = precomputeFlags({
    paths: changedPaths,
    diffText: diff,
    linesAdded: pr.linesAdded,
    linesRemoved: pr.linesRemoved,
    coverage: null,
  });

  const client = getAnthropic();
  const message = await client.messages.create({
    model: PRE_REVIEW_MODEL,
    max_tokens: 4096,
    thinking: { type: 'adaptive' },
    output_config: {
      effort: 'high',
      format: {
        type: 'json_schema',
        schema: PRE_REVIEW_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
      },
    },
    // system은 stable — 마지막 텍스트 블록에 cache_control 박아 prefix 캐시 활성.
    system: [
      {
        type: 'text',
        text: PRE_REVIEW_SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      {
        role: 'user',
        content: buildPreReviewUserPrompt({
          prTitle: pr.title,
          repoSlug: project.slug,
          authorKind: pr.authorKind,
          linesAdded: pr.linesAdded,
          linesRemoved: pr.linesRemoved,
          filesChanged: pr.filesChanged,
          diff: clampDiff(diff),
        }),
      },
    ],
  });

  const parsed = parseLLMResponse(message.content);

  // LLM flags + 휴리스틱 union (중복 제거).
  const combinedFlags = Array.from(new Set<RiskFlag>([...parsed.flags, ...heuristicFlags]));

  const row = db
    .insert(preReviews)
    .values({
      prId,
      headSha: pr.headSha,
      confidence: parsed.confidence,
      confidenceTier: confidenceTier(parsed.confidence),
      flags: combinedFlags,
      changedPaths,
      hunkAnnotations: parsed.hunkAnnotations,
      summary: parsed.summary,
      comments: parsed.comments,
      testsPassed: null,
      coverage: null,
    })
    .returning()
    .get();

  return { kind: 'analyzed', row };
}

// Anthropic 응답에서 첫 text 블록을 꺼내 JSON 파싱 → zod 검증.
// output_config.format=json_schema 일 때 모델은 text 블록에 JSON 본문을 넣는다.
type ContentBlock = { type: string; text?: string };
function parseLLMResponse(content: ReadonlyArray<ContentBlock>): z.infer<typeof llmResultSchema> {
  const textBlock = content.find((b) => b.type === 'text' && typeof b.text === 'string');
  if (!textBlock?.text) {
    throw new Error('Anthropic 응답에 text 블록이 없습니다.');
  }
  let json: unknown;
  try {
    json = JSON.parse(textBlock.text);
  } catch (err) {
    throw new Error(`Anthropic 응답 JSON 파싱 실패: ${(err as Error).message}`);
  }
  return llmResultSchema.parse(json);
}

// diff 본문에서 변경된 파일 경로 추출 — `diff --git a/x b/x` 줄.
// 단순 정규식 — 100% 정확할 필요는 없고 휴리스틱 flag detection 용.
export function extractPaths(diff: string): string[] {
  const paths = new Set<string>();
  const re = /^diff --git a\/(\S+) b\/(\S+)$/gm;
  for (const match of diff.matchAll(re)) {
    paths.add(match[2] ?? match[1]);
  }
  return [...paths];
}
