import { afterEach, describe, expect, it } from 'vitest';
import {
  clearAutomationInFlight,
  getAutomationInFlight,
  setAutomationInFlight,
} from './automation-state';

afterEach(() => {
  clearAutomationInFlight(1);
  clearAutomationInFlight(2);
});

describe('automation-state', () => {
  it('set 하면 get 으로 kind 가 보인다', () => {
    expect(getAutomationInFlight(1)).toBeNull();
    setAutomationInFlight(1, 'resolving-conflict');
    expect(getAutomationInFlight(1)).toBe('resolving-conflict');
  });

  it('clear 하면 null 로 돌아온다', () => {
    setAutomationInFlight(2, 'fixing-tests');
    expect(getAutomationInFlight(2)).toBe('fixing-tests');
    clearAutomationInFlight(2);
    expect(getAutomationInFlight(2)).toBeNull();
  });

  it('set 갱신 — 같은 PR 의 kind 를 덮어쓴다', () => {
    setAutomationInFlight(1, 'fixing-tests');
    setAutomationInFlight(1, 'addressing-review');
    expect(getAutomationInFlight(1)).toBe('addressing-review');
  });

  it('안 set 된 PR clear 는 멱등 no-op', () => {
    expect(() => clearAutomationInFlight(999)).not.toThrow();
    expect(getAutomationInFlight(999)).toBeNull();
  });
});
