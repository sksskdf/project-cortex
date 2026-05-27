// 환경변수는 사용 시점에 lazy 로딩. 빌드 타임 평가 회피.

function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export const env = {
  // GitHub App 인증 — Phase 3.4 부터 PAT 대신 사용.
  // - APP_ID: App 설정 페이지 상단의 숫자.
  // - PRIVATE_KEY: App 페이지에서 "Generate a private key" 로 받은 .pem 내용.
  //   여러 줄 문자열이므로 .env.local 에서는 따옴표로 감싸야 함.
  githubAppId: () => required('GITHUB_APP_ID'),
  githubAppPrivateKey: () => required('GITHUB_APP_PRIVATE_KEY'),
  githubWebhookSecret: () => required('GITHUB_WEBHOOK_SECRET'),
  anthropicApiKey: () => required('ANTHROPIC_API_KEY'),
  // Phase 4.5b — Haiku 1차 필터 활성화 토글. '1' 일 때만 두 단계 분기.
  // 기본 비활성 — 기존 테스트·운영 흐름 영향 없음.
  triageEnabled: () => process.env.CORTEX_TRIAGE_ENABLED === '1',
  // Phase 13 — 사전 리뷰 LLM 백엔드. 'cli' (디폴트) = claude CLI 비대화형 spawn (사용자
  // Claude 플랜, Anthropic API 크레딧 0). 'api' = Anthropic SDK 직접 호출 (ANTHROPIC_API_KEY).
  // 크레딧 0 가 기본이라 AI 분석을 켜둔 채로도 비용이 없어 자동 머지 흐름이 막히지 않음.
  preReviewBackend: (): 'cli' | 'api' =>
    process.env.CORTEX_PRE_REVIEW_BACKEND === 'api' ? 'api' : 'cli',
};
