// 환경변수는 사용 시점에 lazy 로딩. 빌드 타임 평가 회피.

function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export const env = {
  githubToken: () => required('GITHUB_TOKEN'),
  githubWebhookSecret: () => required('GITHUB_WEBHOOK_SECRET'),
};
