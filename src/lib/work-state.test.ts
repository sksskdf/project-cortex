import { describe, expect, it } from 'vitest';
import { parseWorkState, serializeWorkState, type WorkStateV1 } from './work-state';

describe('parseWorkState — schema v1', () => {
  it('parses all three sections', () => {
    const md = `# work-state

## 진행 중

- feat/foo: 작업 중 한 줄 상태
- feat/bar: 리뷰 대기

## 다음 단계

- 다음 할 일 1
- 다음 할 일 2

## 메모

- 맥락 한 줄`;
    const ws = parseWorkState(md);
    expect(ws.inProgress).toEqual([
      { item: 'feat/foo', status: '작업 중 한 줄 상태' },
      { item: 'feat/bar', status: '리뷰 대기' },
    ]);
    expect(ws.nextSteps).toEqual(['다음 할 일 1', '다음 할 일 2']);
    expect(ws.notes).toEqual(['맥락 한 줄']);
  });

  it('treats in-progress item without colon as status-less', () => {
    const md = `## 진행 중\n- feat/no-status`;
    const ws = parseWorkState(md);
    expect(ws.inProgress).toEqual([{ item: 'feat/no-status', status: '' }]);
  });

  it('splits in-progress on first colon only (status may contain colons)', () => {
    const md = `## 진행 중\n- feat/x: 상태: 추가 정보`;
    const ws = parseWorkState(md);
    expect(ws.inProgress).toEqual([{ item: 'feat/x', status: '상태: 추가 정보' }]);
  });

  it('ignores HTML comments (incl. the schema header block)', () => {
    const md = `<!--
이 안의 ## 진행 중
- 가짜 항목: 무시돼야 함
-->
## 진행 중
- 진짜: 항목`;
    const ws = parseWorkState(md);
    expect(ws.inProgress).toEqual([{ item: '진짜', status: '항목' }]);
  });

  it('ignores unknown sections', () => {
    const md = `## 알 수 없는 섹션
- 수집되면 안 됨
## 메모
- 메모 항목`;
    const ws = parseWorkState(md);
    expect(ws.inProgress).toEqual([]);
    expect(ws.nextSteps).toEqual([]);
    expect(ws.notes).toEqual(['메모 항목']);
  });

  it('handles missing sections (empty arrays, no throw)', () => {
    const md = `## 다음 단계\n- 유일한 항목`;
    const ws = parseWorkState(md);
    expect(ws.inProgress).toEqual([]);
    expect(ws.nextSteps).toEqual(['유일한 항목']);
    expect(ws.notes).toEqual([]);
  });

  it('handles empty sections', () => {
    const md = `## 진행 중

## 다음 단계

## 메모
`;
    const ws = parseWorkState(md);
    expect(ws).toEqual({ inProgress: [], nextSteps: [], notes: [] });
  });

  it('returns empty state for empty / whitespace input (malformed-tolerant)', () => {
    expect(parseWorkState('')).toEqual({ inProgress: [], nextSteps: [], notes: [] });
    expect(parseWorkState('\n\n   \n')).toEqual({
      inProgress: [],
      nextSteps: [],
      notes: [],
    });
  });

  it('tolerates malformed lines (prose, blank list items, content before any heading)', () => {
    const md = `헤딩 전 자유 텍스트는 무시
- 헤딩 전 리스트도 무시
## 진행 중
- feat/ok: 정상
-
설명 문단은 항목 아님`;
    const ws = parseWorkState(md);
    expect(ws.inProgress).toEqual([{ item: 'feat/ok', status: '정상' }]);
  });

  it('ignores list items in unknown sections after a known one', () => {
    const md = `## 메모
- 메모 1
## 잡담
- 무시
## 메모
- 메모 2`;
    const ws = parseWorkState(md);
    // 같은 섹션이 두 번 나오면 둘 다 수집(append).
    expect(ws.notes).toEqual(['메모 1', '메모 2']);
  });

  it('trims surrounding whitespace on items and statuses', () => {
    const md = `## 진행 중\n-   feat/sp   :   상태   `;
    const ws = parseWorkState(md);
    expect(ws.inProgress).toEqual([{ item: 'feat/sp', status: '상태' }]);
  });
});

describe('serializeWorkState', () => {
  it('emits all three section headings even when empty', () => {
    const out = serializeWorkState({ inProgress: [], nextSteps: [], notes: [] });
    expect(out).toContain('## 진행 중');
    expect(out).toContain('## 다음 단계');
    expect(out).toContain('## 메모');
    expect(out.endsWith('\n')).toBe(true);
  });

  it('renders in-progress with and without status', () => {
    const out = serializeWorkState({
      inProgress: [
        { item: 'feat/a', status: '진행' },
        { item: 'feat/b', status: '' },
      ],
      nextSteps: [],
      notes: [],
    });
    expect(out).toContain('- feat/a: 진행');
    expect(out).toContain('- feat/b\n');
    expect(out).not.toContain('- feat/b: ');
  });

  it('includes the schema header comment', () => {
    const out = serializeWorkState({ inProgress: [], nextSteps: [], notes: [] });
    expect(out).toContain('work-state schema v1');
    expect(out).toContain('<!--');
  });
});

describe('round-trip', () => {
  const cases: { name: string; ws: WorkStateV1 }[] = [
    {
      name: 'full state',
      ws: {
        inProgress: [
          { item: 'feat/work-state-file', status: 'Phase 16 작업 중' },
          { item: 'feat/no-status', status: '' },
        ],
        nextSteps: ['worktree 격리 보류', '반응형 디자인'],
        notes: ['PR 전 typecheck·test 통과', '추가 push 금지'],
      },
    },
    {
      name: 'empty state',
      ws: { inProgress: [], nextSteps: [], notes: [] },
    },
    {
      name: 'only next steps',
      ws: { inProgress: [], nextSteps: ['하나'], notes: [] },
    },
    {
      name: 'status containing colon',
      ws: { inProgress: [{ item: 'x', status: 'a: b' }], nextSteps: [], notes: [] },
    },
  ];

  for (const { name, ws } of cases) {
    it(`serialize → parse is identity (${name})`, () => {
      const reparsed = parseWorkState(serializeWorkState(ws));
      expect(reparsed).toEqual(ws);
    });
  }
});
