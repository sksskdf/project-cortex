import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// @sentry/nextjs 를 모킹 — 실제 네트워크/SDK 부팅 없이 호출 여부만 검증.
const initMock = vi.fn();
const captureMock = vi.fn();
vi.mock('@sentry/nextjs', () => ({
  init: (...args: unknown[]) => initMock(...args),
  captureException: (...args: unknown[]) => captureMock(...args),
}));

describe('sentry (opt-in)', () => {
  const original = process.env.SENTRY_DSN;

  beforeEach(() => {
    vi.resetModules();
    initMock.mockClear();
    captureMock.mockClear();
    delete process.env.SENTRY_DSN;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = original;
  });

  it('DSN 없으면 init 을 호출하지 않는다', async () => {
    const { initSentry } = await import('./sentry');
    initSentry();
    expect(initMock).not.toHaveBeenCalled();
  });

  it('DSN 없으면 captureError 가 no-op 이다', async () => {
    const { captureError } = await import('./sentry');
    captureError(new Error('boom'));
    expect(captureMock).not.toHaveBeenCalled();
  });

  it('DSN 있으면 init 을 한 번만 호출한다', async () => {
    process.env.SENTRY_DSN = 'https://pub@example.ingest.sentry.io/1';
    const { initSentry } = await import('./sentry');
    initSentry();
    initSentry();
    expect(initMock).toHaveBeenCalledTimes(1);
  });

  it('DSN 있으면 captureError 가 예외를 전달한다', async () => {
    process.env.SENTRY_DSN = 'https://pub@example.ingest.sentry.io/1';
    const { captureError } = await import('./sentry');
    const err = new Error('boom');
    captureError(err, { handler: 'check' });
    expect(captureMock).toHaveBeenCalledWith(err, { extra: { handler: 'check' } });
  });
});
