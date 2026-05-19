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
export const PRE_REVIEW_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['confidence', 'flags', 'summary', 'comments', 'hunkAnnotations'],
  properties: {
    confidence: {
      type: 'integer',
      minimum: 0,
      maximum: 100,
      description: '0-100. 90+ 자동 머지 후보, 70-89 가벼운 검토, 50-69 주의, <50 차단.',
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
    comments: {
      type: 'array',
      description: '인라인 코멘트. 라인이 명확하지 않으면 비워둘 것.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'line', 'body'],
        properties: {
          path: { type: 'string' },
          line: { type: 'integer', minimum: 1 },
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
- comments는 명백히 특정 줄을 짚을 수 있을 때만. 추측성 코멘트 금지.
- hunkAnnotations.decision='auto'는 "이 hunk는 자동 머지 가능". 'review'는 "사람이 봐야 함".
- hunkId는 "src/file.ts:42" 형식 (시작 줄 번호).
- 위 플래그 enum 외의 값은 절대 만들지 말 것.
`;

// user 프롬프트 빌더 — PR 메타 + diff 텍스트.
// 토큰 절약: diff가 매우 크면 호출부에서 자르기. 여기선 그대로.
export function buildPreReviewUserPrompt(input: {
  prTitle: string;
  repoSlug: string;
  authorKind: 'agent' | 'human';
  linesAdded: number;
  linesRemoved: number;
  filesChanged: number;
  diff: string;
}): string {
  return [
    `# PR 컨텍스트`,
    `- 저장소: ${input.repoSlug}`,
    `- 제목: ${input.prTitle}`,
    `- 작성자 유형: ${input.authorKind}`,
    `- 변경 규모: +${input.linesAdded} / -${input.linesRemoved} (${input.filesChanged} files)`,
    ``,
    `# Unified diff`,
    '```diff',
    input.diff,
    '```',
    ``,
    `위 PR을 분석해 JSON 스키마에 맞춰 응답하세요.`,
  ].join('\n');
}
