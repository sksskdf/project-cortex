import { describe, expect, it } from 'vitest';
import { AUTO_MERGE_THRESHOLD, confidenceTier } from './confidence';

describe('confidenceTier', () => {
  it('returns high at 90+', () => {
    expect(confidenceTier(100)).toBe('high');
    expect(confidenceTier(90)).toBe('high');
  });

  it('returns medium at 70..89', () => {
    expect(confidenceTier(89)).toBe('medium');
    expect(confidenceTier(70)).toBe('medium');
  });

  it('returns low at 50..69', () => {
    expect(confidenceTier(69)).toBe('low');
    expect(confidenceTier(50)).toBe('low');
  });

  it('returns critical below 50', () => {
    expect(confidenceTier(49)).toBe('critical');
    expect(confidenceTier(0)).toBe('critical');
  });
});

describe('AUTO_MERGE_THRESHOLD', () => {
  it('equals 90 — DOMAIN §3 high tier 하한과 일치', () => {
    expect(AUTO_MERGE_THRESHOLD).toBe(90);
  });
});
