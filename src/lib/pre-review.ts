// Phase 4.2 — PR을 받아 Anthropic 분석을 돌리고 pre_reviews 행을 만든다.
// 캐싱: (prId, headSha) 유니크 인덱스가 잡혀 있어 같은 SHA면 기존 행을 반환.
// LLM 결과의 flags는 휴리스틱(lib/risk-flags) 결과와 union — LLM이 놓친 신호도 잡힘.

import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { preReviews, prs, projects } from '@/db/schema';
import type { PreReviewRow } from '@/db/schema';
import { parseJsonFromText, runClaudeHeadless } from './claude-cli';
import { confidenceTier } from './confidence';
import { budgetDiff } from './diff-budget';
import { attachCommentsToFiles, parseUnifiedDiff } from './diff-parser';
import { env } from './env';
import { getPRDiff, listCheckRunsForRef } from './github';
import { getSettings } from './settings';
import {
  buildPreReviewTriagePrompt,
  buildPreReviewUserPrompt,
  PRE_REVIEW_SYSTEM_PROMPT,
  PRE_REVIEW_TRIAGE_SYSTEM_PROMPT,
  RISK_FLAGS,
} from './prompts/pre-review';

// claude CLI 에 전달할 모델 — 본 분석은 Opus, 1차 triage 는 Haiku.
// (구 anthropic.ts 에서 이전 — API SDK 경로 제거 Phase.)
const PRE_REVIEW_MODEL = 'claude-opus-4-7';
const PRE_REVIEW_TRIAGE_MODEL = 'claude-haiku-4-5-20251001';
import { precomputeFlags } from './risk-flags';
import type { RiskFlag } from './types';

// 결과 schema — Anthropic 응답을 JSON.parse 한 직후 검증.
const llmResultSchema = z.object({
  confidence: z.number().int().min(0).max(100),
  flags: z.array(z.enum(RISK_FLAGS as readonly [RiskFlag, ...RiskFlag[]])),
  summary: z.string(),
  // Phase 20 — 사용자가 머지 전/후 확인하면 좋을 체크포인트(짧은 불릿 0~5개). 안전하면 빈 배열.
  whatToCheck: z.array(z.string()).default([]),
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

// Haiku triage 응답 schema.
const triageResultSchema = z.object({
  needsDeepReview: z.boolean(),
  confidence: z.number().int().min(0).max(100),
  flagCandidates: z.array(z.enum(RISK_FLAGS as readonly [RiskFlag, ...RiskFlag[]])),
  summary: z.string(),
});

// R1 (Phase 13.6) — claude CLI `--json-schema` 로 넘길 JSON Schema. zod 와 1:1 미러.
// CLI 가 스키마 검증된 structured_output 을 돌려줘 parseJsonFromText(산문-속-객체 추출)
// 취약점을 제거한다. 추출 후에도 zod 로 재검증(enum/범위) — 미지원 CLI 폴백 시 동일 경로.
const llmResultJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    confidence: { type: 'integer', minimum: 0, maximum: 100 },
    flags: { type: 'array', items: { type: 'string', enum: RISK_FLAGS } },
    summary: { type: 'string' },
    whatToCheck: { type: 'array', items: { type: 'string' } },
    comments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string' },
          line: { type: 'integer', minimum: 1 },
          body: { type: 'string' },
        },
        required: ['path', 'line', 'body'],
      },
    },
    hunkAnnotations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          hunkId: { type: 'string' },
          decision: { type: 'string', enum: ['auto', 'review'] },
          reason: { type: 'string' },
        },
        required: ['hunkId', 'decision'],
      },
    },
  },
  required: ['confidence', 'flags', 'summary', 'whatToCheck', 'comments', 'hunkAnnotations'],
} as const;

const triageResultJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    needsDeepReview: { type: 'boolean' },
    confidence: { type: 'integer', minimum: 0, maximum: 100 },
    flagCandidates: { type: 'array', items: { type: 'string', enum: RISK_FLAGS } },
    summary: { type: 'string' },
  },
  required: ['needsDeepReview', 'confidence', 'flagCandidates', 'summary'],
} as const;

// Haiku 결과로 Opus 호출 생략이 안전한지 판정. 셋 다 만족해야 단순 PR.
function isSimpleByTriage(t: z.infer<typeof triageResultSchema>): boolean {
  return t.needsDeepReview === false && t.flagCandidates.length === 0 && t.confidence >= 80;
}

export type AnalyzeResult =
  | { kind: 'cached'; row: PreReviewRow }
  | { kind: 'analyzed'; row: PreReviewRow }
  | { kind: 'skipped'; reason: 'no-pr' | 'no-project' | 'no-installation' | 'ai-disabled' };

type PromptInput = {
  prTitle: string;
  repoSlug: string;
  authorKind: 'agent' | 'human';
  linesAdded: number;
  linesRemoved: number;
  filesChanged: number;
  // PR 설명(본문) — 작성자 의도. 리뷰 정확도 향상을 위해 프롬프트에 포함. 빈 PR 은 null.
  prBody: string | null;
  diff: string;
};

// 사전 리뷰 LLM 호출 — claude CLI 비대화형 spawn (사용자 Claude 플랜, API 크레딧 0).
// JSON schema 강제가 없어 프롬프트로 지시 + parseJsonFromText + zod 로 검증.

async function callTriageLLM(
  promptInput: PromptInput,
): Promise<z.infer<typeof triageResultSchema>> {
  const res = await runClaudeHeadless({
    input: `${PRE_REVIEW_TRIAGE_SYSTEM_PROMPT}\n\n${buildPreReviewTriagePrompt(promptInput)}`,
    instruction:
      '위 입력의 규칙대로 PR 을 1차 분류하고, 지정 JSON 객체만 출력하세요. 산문·코드펜스 금지.',
    model: PRE_REVIEW_TRIAGE_MODEL,
    jsonSchema: triageResultJsonSchema,
  });
  if (!res.ok) throw new Error(`triage(CLI) 실패: ${res.reason}`);
  // structured_output(스키마 검증) 우선, 미지원 CLI 폴백 시 텍스트 파싱. zod 로 재검증.
  return triageResultSchema.parse(res.structured ?? parseJsonFromText(res.text));
}

async function callMainLLM(promptInput: PromptInput): Promise<z.infer<typeof llmResultSchema>> {
  const res = await runClaudeHeadless({
    input: `${PRE_REVIEW_SYSTEM_PROMPT}\n\n${buildPreReviewUserPrompt(promptInput)}`,
    instruction:
      '위 입력을 분석해 지정된 JSON 스키마에 맞는 JSON 객체만 출력하세요. 산문·코드펜스 금지.',
    model: PRE_REVIEW_MODEL,
    jsonSchema: llmResultJsonSchema,
  });
  if (!res.ok) throw new Error(`pre-review(CLI) 실패: ${res.reason}`);
  // structured_output(스키마 검증) 우선, 미지원 CLI 폴백 시 텍스트 파싱. zod 로 재검증.
  return llmResultSchema.parse(res.structured ?? parseJsonFromText(res.text));
}

export async function analyzePR(prId: number): Promise<AnalyzeResult> {
  // 안전망 — settings.aiEnabled=false 면 호출 자체 차단 (Anthropic 크레딧 0).
  // 호출처가 sync.ts safeAnalyze 하나뿐이지만 미래의 호출 누락 대비.
  if (!getSettings().aiEnabled) return { kind: 'skipped', reason: 'ai-disabled' };

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
  // diff + Check Runs 병렬 — 후자는 LLM 입력에 안 쓰이지만 prs.testsPassed 초기값.
  // checks 실패는 무시 (네트워크 일시 오류 등) — null 로 두고 webhook 이 나중에 갱신.
  const [diff, initialChecks] = await Promise.all([
    getPRDiff(project.installationId, { owner, repo }, pr.number),
    listCheckRunsForRef(project.installationId, { owner, repo }, pr.headSha).catch((err) => {
      console.error(`listCheckRunsForRef failed for PR ${prId}, falling back to null:`, err);
      return null;
    }),
  ]);
  const testsPassedInitial: boolean | null =
    initialChecks === null
      ? null
      : initialChecks.status === 'passed'
        ? true
        : initialChecks.status === 'failed'
          ? false
          : null;
  // CI 결과는 prs 컬럼에 저장. 이미 webhook 으로 갱신됐을 수 있으니 (race) 덮어쓰지
  // 말고 prs.testsPassed 가 null 일 때만 채움.
  if (testsPassedInitial !== null && pr.testsPassed === null) {
    db.update(prs).set({ testsPassed: testsPassedInitial }).where(eq(prs.id, prId)).run();
  }
  const changedPaths = extractPaths(diff);

  // Phase 4.5a — diff 토큰 예산 적용. 우선순위 정렬 + lock·generated 본문 제외 +
  // 상한 초과 시 자르고 LLM 에 명시. clampDiff 단순 잘림을 대체.
  const budget = budgetDiff(diff);

  const heuristicFlags = precomputeFlags({
    paths: changedPaths,
    diffText: diff,
    linesAdded: pr.linesAdded,
    linesRemoved: pr.linesRemoved,
    coverage: null,
  });

  const promptInput: PromptInput = {
    prTitle: pr.title,
    repoSlug: project.slug,
    authorKind: pr.authorKind,
    linesAdded: pr.linesAdded,
    linesRemoved: pr.linesRemoved,
    filesChanged: pr.filesChanged,
    prBody: pr.body,
    diff: budget.text,
  };

  // Phase 4.5b — Haiku 1차. 단순 PR 이면 그 응답으로 종료. throw 시 Opus 폴백.
  if (env.triageEnabled()) {
    let triage: z.infer<typeof triageResultSchema> | null = null;
    try {
      triage = await callTriageLLM(promptInput);
    } catch (err) {
      console.error(`triage failed for PR ${prId}, falling back to deep review:`, err);
    }

    if (triage && isSimpleByTriage(triage)) {
      // 단순 PR — Haiku 응답으로 PreReview 종료. hunk 별 결정은 일괄 'auto'.
      const parsedFiles = parseUnifiedDiff(diff);
      const hunkAnnotations = parsedFiles.flatMap((f) =>
        f.hunks
          .filter((h) => h.kind === 'expanded')
          .map((h) => ({ hunkId: h.id, decision: 'auto' as const })),
      );
      const combinedFlags = Array.from(
        new Set<RiskFlag>([...triage.flagCandidates, ...heuristicFlags]),
      );
      const row = db
        .insert(preReviews)
        .values({
          prId,
          headSha: pr.headSha,
          confidence: triage.confidence,
          confidenceTier: confidenceTier(triage.confidence),
          flags: combinedFlags,
          changedPaths,
          parsedFiles,
          hunkAnnotations,
          summary: triage.summary,
          // 단순 PR(자동 승인) — 특별히 확인할 부분 없음. 상세는 기본 문구를 보여준다.
          whatToCheck: [],
          comments: [],
          // testsPassed 는 prs 컬럼으로 이동 (마이그레이션 0007). preReview 의 컬럼은
          // legacy 호환 위해 schema 에 남았지만 새로 저장 안 함.
          testsPassed: null,
          coverage: null,
        })
        .returning()
        .get();
      return { kind: 'analyzed', row };
    }
    // triage 가 'complex' 거나 호출 실패 → Opus 로 폴 스루.
  }

  const parsed = await callMainLLM(promptInput);

  // LLM flags + 휴리스틱 union (중복 제거).
  const combinedFlags = Array.from(new Set<RiskFlag>([...parsed.flags, ...heuristicFlags]));

  // diff 텍스트를 FileBlock[] 으로 파싱하고 LLM 코멘트를 hunk 에 부착.
  // PR 상세 화면이 이 캐시를 그대로 렌더 — getPRDiff 재호출 없음.
  const parsedFiles = attachCommentsToFiles(parseUnifiedDiff(diff), parsed.comments);

  const row = db
    .insert(preReviews)
    .values({
      prId,
      headSha: pr.headSha,
      confidence: parsed.confidence,
      confidenceTier: confidenceTier(parsed.confidence),
      flags: combinedFlags,
      changedPaths,
      parsedFiles,
      hunkAnnotations: parsed.hunkAnnotations,
      summary: parsed.summary,
      whatToCheck: parsed.whatToCheck,
      comments: parsed.comments,
      // testsPassed 는 prs 컬럼으로 이동 (위 분기와 동일). preReview 는 legacy 컬럼.
      testsPassed: null,
      coverage: null,
    })
    .returning()
    .get();

  return { kind: 'analyzed', row };
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
