import { describe, expect, it } from 'vitest';
import { ciSatisfied, computeMergeGate } from './merge-gate';

describe('ciSatisfied', () => {
  it('true when CI passed', () => {
    expect(ciSatisfied(true, 'unstable')).toBe(true);
  });
  it('true when no CI but mergeable_state clean (testsPassed null + clean)', () => {
    expect(ciSatisfied(null, 'clean')).toBe(true);
  });
  it('false when null + not clean (CI pending/unknown)', () => {
    expect(ciSatisfied(null, 'unstable')).toBe(false);
    expect(ciSatisfied(null, 'unknown')).toBe(false);
    expect(ciSatisfied(null, null)).toBe(false);
  });
  it('false when CI failed', () => {
    expect(ciSatisfied(false, 'clean')).toBe(false);
  });
});

describe('computeMergeGate', () => {
  const base = {
    hasInstall: true,
    active: true,
    testsPassed: true as boolean | null,
    mergeableState: 'clean' as string | null,
    autoMergeEnabled: true,
  };

  it('mergeable when clean + CI passed', () => {
    const g = computeMergeGate(base);
    expect(g.canMerge).toBe(true);
    expect(g.reasonKey).toBeNull();
  });

  it('mergeable for no-CI repo (testsPassed null + clean)', () => {
    const g = computeMergeGate({ ...base, testsPassed: null, mergeableState: 'clean' });
    expect(g.canMerge).toBe(true);
    expect(g.reasonKey).toBeNull();
  });

  it('conflict reason wins for dirty', () => {
    const g = computeMergeGate({ ...base, mergeableState: 'dirty' });
    expect(g.canMerge).toBe(false);
    expect(g.reasonKey).toBe('conflict');
  });

  it('blocked reason for blocked', () => {
    const g = computeMergeGate({ ...base, mergeableState: 'blocked' });
    expect(g.canMerge).toBe(false);
    expect(g.reasonKey).toBe('blocked');
  });

  it('ciFailed when tests failed', () => {
    const g = computeMergeGate({ ...base, testsPassed: false, mergeableState: 'unstable' });
    expect(g.canMerge).toBe(false);
    expect(g.mergeBlockedByCI).toBe(true);
    expect(g.reasonKey).toBe('ciFailed');
  });

  it('ciPending vs ciPendingManual by autoMergeEnabled (testsPassed null + not clean)', () => {
    const auto = computeMergeGate({ ...base, testsPassed: null, mergeableState: 'unstable' });
    expect(auto.reasonKey).toBe('ciPending');
    const manual = computeMergeGate({
      ...base,
      testsPassed: null,
      mergeableState: 'unstable',
      autoMergeEnabled: false,
    });
    expect(manual.reasonKey).toBe('ciPendingManual');
  });

  it('no merge / no reason for seed PR (no install)', () => {
    const g = computeMergeGate({ ...base, hasInstall: false });
    expect(g.canMerge).toBe(false);
    expect(g.reasonKey).toBeNull();
  });

  it('no merge / no reason for merged-or-closed (inactive)', () => {
    const g = computeMergeGate({ ...base, active: false });
    expect(g.canMerge).toBe(false);
    expect(g.reasonKey).toBeNull();
  });
});
