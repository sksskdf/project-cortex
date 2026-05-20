import { describe, expect, it } from 'vitest';
import { budgetDiff, DEFAULT_DIFF_CHAR_BUDGET } from './diff-budget';

function makeFile(path: string, bodyLines: number): string {
  const header = [
    `diff --git a/${path} b/${path}`,
    `index 0000000..1111111 100644`,
    `--- a/${path}`,
    `+++ b/${path}`,
  ].join('\n');
  const hunkHeader = `@@ -1,${bodyLines} +1,${bodyLines} @@`;
  const body = Array.from({ length: bodyLines }, (_, i) => `+line ${i}`).join('\n');
  return `${header}\n${hunkHeader}\n${body}`;
}

describe('budgetDiff', () => {
  it('빈 diff → 빈 결과', () => {
    const r = budgetDiff('');
    expect(r.text).toBe('');
    expect(r.includedPaths).toEqual([]);
    expect(r.originalLength).toBe(0);
  });

  it('상한 안의 작은 diff 는 그대로 통과', () => {
    const diff = makeFile('src/x.ts', 5);
    const r = budgetDiff(diff);
    expect(r.includedPaths).toEqual(['src/x.ts']);
    expect(r.bodySkippedPaths).toEqual([]);
    expect(r.fullySkippedPaths).toEqual([]);
    expect(r.text).toContain('+line 0');
  });

  it('lock 파일은 본문 제외 + bodySkippedPaths 에 표시', () => {
    const diff = [makeFile('src/x.ts', 3), makeFile('package-lock.json', 500)].join('\n');
    const r = budgetDiff(diff);
    expect(r.includedPaths).toEqual(['src/x.ts']);
    expect(r.bodySkippedPaths).toEqual(['package-lock.json']);
    // 본문 (500 라인) 이 텍스트에 들어가지 않았는지.
    expect(r.text).not.toContain('+line 400');
    expect(r.text).toContain('본문 생략');
  });

  it('dist · build · generated 디렉토리도 본문 제외', () => {
    const diff = [
      makeFile('dist/bundle.js', 100),
      makeFile('build/output.css', 100),
      makeFile('src/generated/types.ts', 100),
      makeFile('src/real.ts', 3),
    ].join('\n');
    const r = budgetDiff(diff);
    expect([...r.bodySkippedPaths].sort()).toEqual([
      'build/output.css',
      'dist/bundle.js',
      'src/generated/types.ts',
    ]);
    expect(r.includedPaths).toEqual(['src/real.ts']);
  });

  it('위험 도메인 파일이 일반 파일보다 먼저 출현', () => {
    const diff = [makeFile('src/utils.ts', 3), makeFile('src/payment/billing.ts', 3)].join('\n');
    const r = budgetDiff(diff);
    const posPayment = r.text.indexOf('src/payment/billing.ts');
    const posUtils = r.text.indexOf('src/utils.ts');
    expect(posPayment).toBeGreaterThanOrEqual(0);
    expect(posUtils).toBeGreaterThan(posPayment);
  });

  it('상한 초과 시 후순위 파일 본문이 잘리고 노트가 들어감', () => {
    // 위험 1개 (작음) + 일반 3개 (각 큼) — 일반 파일 본문이 잘림.
    const diff = [
      makeFile('src/auth/login.ts', 2),
      makeFile('src/a.ts', 4000),
      makeFile('src/b.ts', 4000),
      makeFile('src/c.ts', 4000),
    ].join('\n');
    const r = budgetDiff(diff, 20_000);
    expect(r.includedPaths).toContain('src/auth/login.ts');
    expect(r.finalLength).toBeLessThanOrEqual(20_000 + 500); // budget 근처
    expect(r.bodySkippedPaths.length + r.fullySkippedPaths.length).toBeGreaterThan(0);
    // 잘렸음을 LLM 이 인지하도록 노트가 들어감.
    expect(r.text).toMatch(/본문 잘림|파일 전체 생략/);
  });

  it('기본 예산은 50,000 chars', () => {
    expect(DEFAULT_DIFF_CHAR_BUDGET).toBe(50_000);
  });

  it('파일 헤더가 없는 raw diff (단일 hunk) — splitFiles 가 0개 block 반환 → 빈 출력', () => {
    // 헤더 없이 hunk 만 — 비정상 입력. fully skip 카운트도 0 (block 자체가 없음).
    const r = budgetDiff('@@ -1,1 +1,1 @@\n+x');
    expect(r.includedPaths).toEqual([]);
    expect(r.text).toBe('');
  });
});
