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
  // Phase 4.5b — Haiku 1차 필터 활성화 토글. '1' 일 때만 두 단계 분기.
  // 기본 비활성 — 기존 테스트·운영 흐름 영향 없음.
  triageEnabled: () => process.env.CORTEX_TRIAGE_ENABLED === '1',
};

// 사전 리뷰·충돌 해결·테스트 수정 등 모든 LLM 작업은 claude CLI (사용자 Claude 플랜)로만
// 동작한다. Anthropic API SDK 경로와 ANTHROPIC_API_KEY 는 제거됨 (크레딧 0 목표).
