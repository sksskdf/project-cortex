// Phase 7 — Sentry 에러 트래킹 (opt-in).
// SENTRY_DSN 이 없으면 init 도 capture 도 전부 no-op — 로컬 dev 동작에 영향 없음.
// 커스텀 서버(server.ts)라 vanilla Next 의 자동 init 에 의존하지 않고,
// instrumentation.ts 의 register() 에서 initSentry() 를 한 번 호출합니다.

import * as Sentry from '@sentry/nextjs';

let initialized = false;

/** SENTRY_DSN 이 있을 때만 Sentry 를 초기화. 없으면 조용히 종료. */
export function initSentry(): void {
  if (initialized) return;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  });
  initialized = true;
}

/**
 * 중앙 에러 캡처. DSN 미설정이면 no-op 이라 호출부는 가드 없이 써도 안전.
 * 호출부의 console.error 를 대체하지 않고 보강합니다 (로그는 그대로 남김).
 */
export function captureError(err: unknown, context?: Record<string, unknown>): void {
  if (!process.env.SENTRY_DSN) return;
  Sentry.captureException(err, context ? { extra: context } : undefined);
}
