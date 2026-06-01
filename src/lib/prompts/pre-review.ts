// Phase 4 사전 리뷰 프롬프트. system은 stable (캐시 prefix), user는 PR마다 가변.
// DOMAIN.md §2 (신뢰 점수)·§3 (티어)·§4 (자동 머지)·§5 (위험 플래그) 룰을 LLM에 주입.
// 결과는 output_config.format 으로 JSON schema 강제 — JSON.parse + zod 검증.

import type { RiskFlag } from '@/lib/types';

// 모든 위험 플래그 (lib/types와 일치). LLM이 임의 문자열을 만들지 못하게 enum 고정.
export const RISK_FLAGS: ReadonlyArray<RiskFlag> = [
  'payment-domain',
  'auth-domain',
  'migration',
  'security-sensitive',
  'external-api-new',
  'low-coverage',
  'large-change',
];

// 출력 스키마 — Anthropic output_config.format.schema 에 그대로 박힘.
// strict한 JSON Schema (additionalProperties: false) 로 hallucinated 필드 차단.
// Anthropic structured outputs 의 JSON schema 는 integer 의 minimum/maximum 미지원
// (400 invalid_request_error: "For 'integer' type, properties maximum, minimum are not supported").
// 범위 제약은 description 에 자연어로 기재하고, 런타임 검증은 zod 가 담당 (lib/pre-review.ts).
export const PRE_REVIEW_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['confidence', 'flags', 'summary', 'whatToCheck', 'comments', 'hunkAnnotations'],
  properties: {
    confidence: {
      type: 'integer',
      description: '0-100 범위. 90+ 자동 머지 후보, 70-89 가벼운 검토, 50-69 주의, <50 차단.',
    },
    flags: {
      type: 'array',
      items: { type: 'string', enum: RISK_FLAGS },
      description: '해당하는 위험 플래그. 없으면 빈 배열.',
    },
    summary: {
      type: 'string',
      description: '한국어 1-3문장. 변경 내용 + 가장 큰 위험·인상.',
    },
    whatToCheck: {
      type: 'array',
      items: { type: 'string' },
      description:
        '사용자(메인테이너)가 머지 전/후 직접 확인하면 좋을 체크포인트 0-5개. 각 항목 한국어 ' +
        '한 줄(마크다운 금지). 부작용·검증할 동작·놓치기 쉬운 영향 위주. 안전한 단순 변경이면 빈 배열.',
    },
    comments: {
      type: 'array',
      description: '인라인 코멘트. 라인이 명확하지 않으면 비워둘 것.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'line', 'body'],
        properties: {
          path: { type: 'string' },
          line: { type: 'integer', description: '1 이상의 줄 번호.' },
          body: { type: 'string' },
        },
      },
    },
    hunkAnnotations: {
      type: 'array',
      description: 'hunk 단위 결정. hunkId는 "path:startLine" 형식.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['hunkId', 'decision'],
        properties: {
          hunkId: { type: 'string' },
          decision: { type: 'string', enum: ['auto', 'review'] },
          reason: { type: 'string' },
        },
      },
    },
  },
} as const;

// system 프롬프트 — 모든 호출에서 동일. cache_control breakpoint 의 prefix 가 됨.
// DOMAIN.md 룰을 직접 박아둠 — 별도 파일 읽기 없이 LLM이 self-contained 판단.
export const PRE_REVIEW_SYSTEM_PROMPT = `당신은 Project Cortex의 자동 PR 사전 리뷰어입니다.
사람이 PR을 보기 전에 자동 머지 가능 여부를 판단하기 위한 1차 분석을 수행합니다.

## 신뢰 점수 (0-100)
- 90+: 자동 머지 후보. 의도 명확, 테스트 적절, 위험 영역 없음.
- 70-89: 가벼운 사람 검토. 작지만 검토할 부분 있음.
- 50-69: 주의. 명확하지 않거나 영향 범위 큼.
- <50: 차단. 위험하거나 의도 불명.

## 위험 플래그
- payment-domain: 결제·청구·환불·인보이스 로직 변경
- auth-domain: 인증·세션·JWT·OAuth 변경
- migration: 스키마 마이그레이션·DDL 포함
- security-sensitive: 비밀번호·시크릿·credential·crypto 처리
- external-api-new: 새로운 외부 API 호출 추가 (fetch/axios/http)
- low-coverage: 추가 코드 대비 테스트 부족 (커버리지 70% 미만 추정)
- large-change: 500줄 초과 변경

## 출력 규칙
- 반드시 제공된 JSON 스키마에 맞춰 응답.
- summary는 한국어 1-3문장. 마크다운 금지.
- whatToCheck는 사용자가 직접 확인하면 좋을 체크포인트(부작용·검증할 동작 등) 0-5개. 안전하면 빈 배열.
- comments는 명백히 특정 줄을 짚을 수 있을 때만. 추측성 코멘트 금지.
- hunkAnnotations.decision='auto'는 "이 hunk는 자동 머지 가능". 'review'는 "사람이 봐야 함".
- hunkId는 "src/file.ts:42" 형식 (시작 줄 번호).
- 위 플래그 enum 외의 값은 절대 만들지 말 것.

## 출력 형식 (반드시 준수)
아래 JSON Schema 를 만족하는 **JSON 객체 하나만** 출력하세요. 산문·설명·코드펜스 금지.
required 키(confidence, flags, summary, whatToCheck, comments, hunkAnnotations)를 모두 포함하고, 해당
항목이 없으면 빈 배열([])로 둡니다. confidence 는 0-100 정수.
${JSON.stringify(PRE_REVIEW_OUTPUT_SCHEMA)}
`;

// PR 설명(본문) — 작성자 의도가 담겨 리뷰 판단(의도 부합·위험)에 중요. 토큰 보호 위해 길면 자른다.
const MAX_PR_BODY = 2000;
function prDescriptionLines(prBody: string | null): string[] {
  const body = prBody?.trim();
  if (!body) return [];
  const text = body.length > MAX_PR_BODY ? `${body.slice(0, MAX_PR_BODY)}\n…(생략)` : body;
  return ['', `# PR 설명 (작성자 의도 — 검토 참고)`, text];
}

// Phase 4.7 — 연결된 위임 이슈의 spec(수용 기준). PR 이 원래 무엇을 하기로 한 일이었는지
// 리뷰가 판단할 수 있게. 사람 PR(매칭 없음)이면 빈 배열 — 컨텍스트 없이 진행.
const MAX_ISSUE_SPEC = 1500;
function issueSpecLines(issue: { title: string; spec: string } | null): string[] {
  if (!issue) return [];
  const spec = issue.spec.trim();
  const text = spec.length > MAX_ISSUE_SPEC ? `${spec.slice(0, MAX_ISSUE_SPEC)}\n…(생략)` : spec;
  return ['', `# 위임 이슈 수용 기준 (이 PR 이 만족해야 하는 spec)`, `## ${issue.title}`, text];
}

// user 프롬프트 빌더 — PR 메타 + 위임 이슈 spec + 설명(본문) + diff 텍스트.
// 토큰 절약: diff가 매우 크면 호출부에서 자르기. 여기선 그대로.
export function buildPreReviewUserPrompt(input: {
  prTitle: string;
  repoSlug: string;
  authorKind: 'agent' | 'human';
  linesAdded: number;
  linesRemoved: number;
  filesChanged: number;
  prBody: string | null;
  diff: string;
  // Phase 4.7 — 위임 이슈가 있으면 그 수용 기준을 컨텍스트로. 없으면 null (사람 PR 등).
  issueContext?: { title: string; spec: string } | null;
}): string {
  return [
    `# PR 컨텍스트`,
    `- 저장소: ${input.repoSlug}`,
    `- 제목: ${input.prTitle}`,
    `- 작성자 유형: ${input.authorKind}`,
    `- 변경 규모: +${input.linesAdded} / -${input.linesRemoved} (${input.filesChanged} files)`,
    ...issueSpecLines(input.issueContext ?? null),
    ...prDescriptionLines(input.prBody),
    ``,
    `# Unified diff`,
    '```diff',
    input.diff,
    '```',
    ``,
    `위 PR을 분석해 JSON 스키마에 맞춰 응답하세요.`,
  ].join('\n');
}

// Phase 4.5b — Haiku 1차 분류용 schema. PRE_REVIEW_OUTPUT_SCHEMA 보다 가벼움.
// 깊은 분석이 필요하다고 판단되면 needsDeepReview=true 로 Opus 재호출 트리거.
export const PRE_REVIEW_TRIAGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['needsDeepReview', 'confidence', 'flagCandidates', 'summary'],
  properties: {
    needsDeepReview: {
      type: 'boolean',
      description:
        'true 면 Opus 로 추가 분석이 필요. 결제·인증·migration·보안 의심 / 큰 변경 / 의도 불명 인 경우.',
    },
    confidence: {
      type: 'integer',
      description: '0-100. Haiku 1차 추정. 자신감 낮으면 needsDeepReview=true 권장.',
    },
    flagCandidates: {
      type: 'array',
      items: { type: 'string', enum: RISK_FLAGS },
      description: '1차 인상에서 의심되는 위험 플래그. 확정 아님 — Opus 가 확정.',
    },
    summary: {
      type: 'string',
      description: '한국어 1문장. 변경 내용 간략.',
    },
  },
} as const;

// triage system 프롬프트 — 본 분석보다 짧고 단순. 빠른 분류가 목적.
export const PRE_REVIEW_TRIAGE_SYSTEM_PROMPT = `당신은 Project Cortex 의 빠른 1차 PR 분류기입니다.
PR diff 를 훑어 깊은 분석이 필요한지(needsDeepReview) 판단하는 게 주 임무입니다.

## needsDeepReview=true 로 표시할 경우
- 결제·인증·migration·보안·외부 API 도메인 변경 의심
- 500줄 초과 변경
- 의도가 명확히 안 잡히거나 위험 신호가 보임
- 자신감(confidence) 이 80 미만

## needsDeepReview=false 로 표시할 경우
- 단순 의존성 마이너 업데이트, 문서 수정, 오타 fix, 타입 정의 추가 등
- 위험 영역 안 건드림 + 의도 명확 + confidence 80+

## 출력 규칙
- 반드시 제공된 JSON 스키마.
- summary 는 한국어 1문장 (마크다운 금지).
- 위험 플래그 enum 외 값 금지.

## 출력 형식 (반드시 준수)
아래 JSON Schema 를 만족하는 **JSON 객체 하나만** 출력하세요. 산문·설명·코드펜스 금지.
required 키(needsDeepReview, confidence, flagCandidates, summary)를 모두 포함합니다.
${JSON.stringify(PRE_REVIEW_TRIAGE_SCHEMA)}
`;

// triage 응답 user 프롬프트 — 본 프롬프트와 같은 컨텍스트를 더 짧게.
export function buildPreReviewTriagePrompt(input: {
  prTitle: string;
  repoSlug: string;
  authorKind: 'agent' | 'human';
  linesAdded: number;
  linesRemoved: number;
  filesChanged: number;
  prBody: string | null;
  diff: string;
  // Phase 4.7 — 위임 이슈 컨텍스트(있으면). triage 가 본 분석 필요 여부를 더 정확히 판단.
  issueContext?: { title: string; spec: string } | null;
}): string {
  return [
    `# PR 컨텍스트`,
    `- 저장소: ${input.repoSlug}`,
    `- 제목: ${input.prTitle}`,
    `- 작성자: ${input.authorKind}`,
    `- 규모: +${input.linesAdded} / -${input.linesRemoved} (${input.filesChanged} files)`,
    ...issueSpecLines(input.issueContext ?? null),
    ...prDescriptionLines(input.prBody),
    ``,
    `# diff`,
    '```diff',
    input.diff,
    '```',
    ``,
    `이 PR 이 깊은 분석을 필요로 하는지 판단해 JSON 으로 응답하세요.`,
  ].join('\n');
}
