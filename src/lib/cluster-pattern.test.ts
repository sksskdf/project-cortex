import { describe, expect, it } from 'vitest';
import type { PreReviewRow, PRRecord } from '@/db/schema';
import type { FileBlock } from '@/lib/types';
import { derivePattern, deriveIndividualReviewNumber } from './cluster-pattern';

type MemberOpts = {
  number: number;
  flags?: string[];
  paths?: string[];
  parsedFiles?: FileBlock[];
};

function member(opts: MemberOpts): { pr: PRRecord; preReview: PreReviewRow } {
  const pr = {
    id: opts.number,
    repoId: 1,
    number: opts.number,
    title: `PR ${opts.number}`,
    authorKind: 'agent',
    authorId: 'devin',
    headSha: `sha-${opts.number}`,
    linesAdded: 10,
    linesRemoved: 1,
    filesChanged: opts.paths?.length ?? 1,
    status: 'review-needed',
    clusterId: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as PRRecord;
  const preReview = {
    id: opts.number,
    prId: opts.number,
    headSha: pr.headSha,
    confidence: 85,
    confidenceTier: 'medium',
    flags: opts.flags ?? [],
    changedPaths: opts.paths ?? ['src/foo.ts'],
    parsedFiles: opts.parsedFiles ?? [],
    hunkAnnotations: null,
    summary: null,
    comments: null,
    testsPassed: true,
    coverage: 0.9,
    analyzedAt: new Date(),
  } as unknown as PreReviewRow;
  return { pr, preReview };
}

describe('derivePattern', () => {
  it('returns null for empty members', () => {
    expect(derivePattern([])).toBeNull();
  });

  it('생성된 description 에 공통 경로 포함', () => {
    const r = derivePattern([
      member({ number: 1, paths: ['src/i18n/ko.ts'] }),
      member({ number: 2, paths: ['src/i18n/ko.ts'] }),
      member({ number: 3, paths: ['src/i18n/ko.ts'] }),
    ])!;
    const concat = r.descriptionSegments.map((s) => s.text).join('');
    expect(concat).toContain('3개 PR');
    expect(r.descriptionSegments.some((s) => s.code && s.text === 'src/i18n/ko.ts')).toBe(true);
  });

  it('공통 경로가 없으면 noCommonPath 메시지', () => {
    const r = derivePattern([
      member({ number: 1, paths: ['a.ts'] }),
      member({ number: 2, paths: ['b.ts'] }),
    ])!;
    expect(r.descriptionSegments[0].text).toContain('파일 경로는 분기');
  });

  it('patternSourceLabel 은 첫 PR 번호+제목', () => {
    const r = derivePattern([member({ number: 5 }), member({ number: 3 }), member({ number: 7 })])!;
    // 정렬 후 첫 번호 = 3.
    expect(r.patternSourceLabel).toBe('#3 PR 3');
  });

  it('patternLines 는 첫 PR 의 첫 expanded hunk 에서 추출', () => {
    const parsed: FileBlock[] = [
      {
        path: 'src/foo.ts',
        status: 'ok',
        additions: 1,
        deletions: 0,
        hunks: [
          {
            kind: 'expanded',
            id: 'h1',
            reason: { text: '', tone: 'info' },
            lines: [{ lineNumber: 1, text: 'hello', kind: 'add' }],
          },
        ],
      },
    ];
    const r = derivePattern([member({ number: 1, parsedFiles: parsed }), member({ number: 2 })])!;
    expect(r.patternLines).toHaveLength(1);
    expect(r.patternLines[0].text).toBe('hello');
  });

  it('parsedFiles 가 비어 있으면 patternLines 도 빈 배열', () => {
    const r = derivePattern([member({ number: 1 }), member({ number: 2 })])!;
    expect(r.patternLines).toEqual([]);
  });

  it('동일 flags 인 PR 들은 한 diff row 로 묶이고 outlier 는 별도 행', () => {
    const r = derivePattern([
      member({ number: 1, flags: [] }),
      member({ number: 2, flags: [] }),
      member({ number: 3, flags: [] }),
      member({ number: 4, flags: ['migration'] }),
    ])!;
    expect(r.diffs).toHaveLength(2);
    expect(r.diffs[0].prNumbers).toEqual([1, 2, 3]);
    expect(r.diffs[1].prNumbers).toEqual([4]);
  });

  it('단독 outlier 가 있으면 decisionNote 가 그 번호를 강조', () => {
    const r = derivePattern([
      member({ number: 1, flags: [] }),
      member({ number: 2, flags: [] }),
      member({ number: 3, flags: ['migration'] }),
    ])!;
    expect(r.decisionNote.highlight).toContain('#3');
  });

  it('모두 동일하면 decisionNote 는 균일 메시지', () => {
    const r = derivePattern([member({ number: 1 }), member({ number: 2 }), member({ number: 3 })])!;
    expect(r.decisionNote.highlight).toContain('3');
    expect(r.decisionNote.highlight).toContain('동일 패턴');
  });
});

describe('deriveIndividualReviewNumber', () => {
  it('단독 outlier flag-set 이 있으면 그 PR number 반환', () => {
    const n = deriveIndividualReviewNumber([
      member({ number: 1, flags: [] }),
      member({ number: 2, flags: [] }),
      member({ number: 3, flags: ['migration'] }),
    ]);
    expect(n).toBe(3);
  });

  it('모두 동일 flag-set 이면 0', () => {
    const n = deriveIndividualReviewNumber([
      member({ number: 1, flags: ['ui-change'] }),
      member({ number: 2, flags: ['ui-change'] }),
      member({ number: 3, flags: ['ui-change'] }),
    ]);
    expect(n).toBe(0);
  });

  it('flag-set 그룹이 3개 이상이면 outlier 채택하지 않음', () => {
    const n = deriveIndividualReviewNumber([
      member({ number: 1, flags: ['a'] }),
      member({ number: 2, flags: ['b'] }),
      member({ number: 3, flags: ['c'] }),
    ]);
    expect(n).toBe(0);
  });

  it('PR 1건이면 0', () => {
    const n = deriveIndividualReviewNumber([member({ number: 1 })]);
    expect(n).toBe(0);
  });
});
