// Phase 7 — Next.js instrumentation hook. register() 는 서버 부팅 시 1회 실행됩니다
// (커스텀 server.ts 의 app.prepare() 경로 포함). Sentry 는 opt-in 이라
// SENTRY_DSN 이 없으면 initSentry() 가 즉시 return 합니다.

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initSentry } = await import('@/lib/sentry');
    initSentry();
  }
}
