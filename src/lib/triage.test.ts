import { describe, expect, it } from 'vitest';
import { decideTriage, type TriageInput } from './triage';

function base(overrides: Partial<TriageInput> = {}): TriageInput {
  return {
    authorKind: 'agent',
    confidence: 95,
    flags: [],
    testsPassed: true,
    autoMergeEnabled: true,
    ...overrides,
  };
}

describe('decideTriage', () => {
  it('auto-merge when all conditions met', () => {
    const r = decideTriage(base());
    expect(r.decision).toBe('auto-merge');
  });

  it('human-review for human author regardless of other signals', () => {
    const r = decideTriage(base({ authorKind: 'human', confidence: 100 }));
    expect(r.decision).toBe('human-review');
    expect(r.reason).toContain('사람 작성 PR');
  });

  it('human-review when project autoMergeEnabled is false', () => {
    const r = decideTriage(base({ autoMergeEnabled: false }));
    expect(r.decision).toBe('human-review');
    expect(r.reason).toContain('자동 머지 정책이 꺼져');
  });

  it('human-review for payment-domain flag (with reason)', () => {
    const r = decideTriage(base({ flags: ['payment-domain'] }));
    expect(r.decision).toBe('human-review');
    expect(r.reason).toContain('결제 도메인');
  });

  it('human-review for migration flag', () => {
    const r = decideTriage(base({ flags: ['migration'] }));
    expect(r.decision).toBe('human-review');
    expect(r.reason).toContain('마이그레이션');
  });

  it('human-review for any blocking flag (auth-domain)', () => {
    const r = decideTriage(base({ flags: ['auth-domain'] }));
    expect(r.decision).toBe('human-review');
    expect(r.reason).toContain('인증 도메인');
  });

  it('human-review for security-sensitive flag', () => {
    const r = decideTriage(base({ flags: ['security-sensitive'] }));
    expect(r.decision).toBe('human-review');
    expect(r.reason).toContain('보안');
  });

  it('human-review for external-api-new flag', () => {
    const r = decideTriage(base({ flags: ['external-api-new'] }));
    expect(r.decision).toBe('human-review');
    expect(r.reason).toContain('외부 API');
  });

  it('human-review when tests failed', () => {
    const r = decideTriage(base({ testsPassed: false }));
    expect(r.decision).toBe('human-review');
    expect(r.reason).toContain('테스트 실패');
  });

  it('human-review when tests not run (null)', () => {
    const r = decideTriage(base({ testsPassed: null }));
    expect(r.decision).toBe('human-review');
    expect(r.reason).toContain('테스트 결과가 없습니다');
  });

  it('human-review when confidence below 90', () => {
    const r = decideTriage(base({ confidence: 89 }));
    expect(r.decision).toBe('human-review');
    expect(r.reason).toContain('89점');
  });

  it('auto-merge at exactly 90 confidence', () => {
    expect(decideTriage(base({ confidence: 90 })).decision).toBe('auto-merge');
  });

  it('ignores non-blocking flags (low-coverage alone is not a blocker)', () => {
    const r = decideTriage(base({ flags: ['low-coverage'] }));
    expect(r.decision).toBe('auto-merge');
  });

  it('blocking flag wins over high confidence', () => {
    const r = decideTriage(base({ confidence: 100, flags: ['migration'] }));
    expect(r.decision).toBe('human-review');
    expect(r.reason).toContain('마이그레이션');
  });
});
