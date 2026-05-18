import { describe, expect, it } from 'vitest';
import { orderInbox } from './queue';
import type { PR } from '@/lib/types';

function makePR(overrides: Partial<PR> = {}): PR {
  return {
    id: 'pr-x',
    title: 'X',
    repo: 'cortex-web',
    number: 1,
    author: { name: 'Devin', kind: 'agent' },
    tags: [],
    reason: { text: '', tone: 'info' },
    additions: 0,
    deletions: 0,
    fileCount: 1,
    ageText: '1시간 전',
    gauge: { value: 80, tier: 'medium' as never },
    ...overrides,
  };
}

describe('orderInbox', () => {
  it('alert before warn before info', () => {
    const result = orderInbox([
      makePR({ id: 'a', reason: { text: '', tone: 'info' } }),
      makePR({ id: 'b', reason: { text: '', tone: 'alert' } }),
      makePR({ id: 'c', reason: { text: '', tone: 'warn' } }),
    ]);
    expect(result.map((p) => p.id)).toEqual(['b', 'c', 'a']);
  });

  it('within same tone, lower gauge first', () => {
    const result = orderInbox([
      makePR({ id: 'a', gauge: { value: 90, tier: 'success' } }),
      makePR({ id: 'b', gauge: { value: 50, tier: 'warning' } }),
      makePR({ id: 'c', gauge: { value: 70, tier: 'blue' } }),
    ]);
    expect(result.map((p) => p.id)).toEqual(['b', 'c', 'a']);
  });

  it('within same tone and gauge, older first', () => {
    const result = orderInbox([
      makePR({ id: 'a', ageText: '5분 전' }),
      makePR({ id: 'b', ageText: '2시간 전' }),
      makePR({ id: 'c', ageText: '30분 전' }),
    ]);
    expect(result.map((p) => p.id)).toEqual(['b', 'c', 'a']);
  });

  it('tone dominates gauge (alert+high-confidence beats info+low-confidence)', () => {
    const result = orderInbox([
      makePR({
        id: 'safe-low',
        reason: { text: '', tone: 'info' },
        gauge: { value: 30, tier: 'error' },
      }),
      makePR({
        id: 'alert-high',
        reason: { text: '', tone: 'alert' },
        gauge: { value: 95, tier: 'success' },
      }),
    ]);
    expect(result.map((p) => p.id)).toEqual(['alert-high', 'safe-low']);
  });

  it('returns a new array, does not mutate input', () => {
    const input: PR[] = [
      makePR({ id: 'a', reason: { text: '', tone: 'info' } }),
      makePR({ id: 'b', reason: { text: '', tone: 'alert' } }),
    ];
    const originalOrder = input.map((p) => p.id);
    orderInbox(input);
    expect(input.map((p) => p.id)).toEqual(originalOrder);
  });

  it('handles empty array', () => {
    expect(orderInbox([])).toEqual([]);
  });

  it('handles single-element array', () => {
    const single = [makePR({ id: 'only' })];
    expect(orderInbox(single).map((p) => p.id)).toEqual(['only']);
  });
});
