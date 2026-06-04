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

  // Phase 4.7 — 잘린 파일 경로가 노트에 노출돼 LLM 이 분석 범위 인지 가능.
  it('fully-skipped 파일 경로가 노트에 포함', () => {
    // 많은 파일 + 작은 budget — 뒷쪽 파일들은 header 도 못 들어가 fullySkipped 로.
    const bigBody = ('+ ' + 'x'.repeat(100) + '\n').repeat(20); // ~2KB 씩
    const file = (path: string) =>
      `diff --git a/${path} b/${path}\nindex 0..1 100644\n--- a/${path}\n+++ b/${path}\n@@ -0,0 +1 @@\n${bigBody}`;
    const paths = Array.from({ length: 30 }, (_, i) => `file${i}.ts`);
    const diff = paths.map(file).join('\n');
    const r = budgetDiff(diff, 3_000);
    expect(r.fullySkippedPaths.length).toBeGreaterThan(0);
    // 노트에 첫 번째 잘린 파일 경로가 들어 있어야 함.
    expect(r.text.includes(r.fullySkippedPaths[0])).toBe(true);
  });

  it('파일 헤더가 없는 raw diff (단일 hunk) — splitFiles 가 0개 block 반환 → 빈 출력', () => {
    // 헤더 없이 hunk 만 — 비정상 입력. fully skip 카운트도 0 (block 자체가 없음).
    const r = budgetDiff('@@ -1,1 +1,1 @@\n+x');
    expect(r.includedPaths).toEqual([]);
    expect(r.text).toBe('');
  });

  // 회귀(리뷰 발견): `auth(?!or)` 가 authorization/authorize 파일을 high 우선순위에서 제외해
  // access-control 파일이 예산 압박 시 본문 잘림/생략됐다. 이제 authz 도 high 로 보존.
  it('authorization 파일을 high 우선순위로 — 일반 파일보다 본문 우선 보존', () => {
    // 각 파일 ~1KB(100줄). 예산은 1.x 파일분 → high 우선순위 1개만 본문 포함, 나머지는 잘림.
    // authz 파일을 입력 2번째에 둬, 정렬이 high 로 끌어올리는지 확인.
    const diff = [
      makeFile('src/a-normal.ts', 100),
      makeFile('src/authorization/policy.ts', 100),
      makeFile('src/b-normal.ts', 100),
    ].join('\n');
    const r = budgetDiff(diff, 1500);
    // authz 파일은 본문까지 포함(우선순위 high). 일반 파일들은 본문 잘림.
    expect(r.includedPaths).toContain('src/authorization/policy.ts');
    expect(r.includedPaths).not.toContain('src/a-normal.ts');
  });

  // 회귀(리뷰 발견): 최종 fully-skipped note 가 budget 검사 없이 push 돼, 경로가 많고 깊으면
  // finalLength 가 charBudget 을 크게 초과했다. note 를 bound 해 오버슈트를 작게 고정.
  it('fully-skipped 경로가 많아도 finalLength 가 budget 을 크게 초과하지 않음', () => {
    const bigBody = ('+ ' + 'x'.repeat(100) + '\n').repeat(20);
    const file = (path: string) =>
      `diff --git a/${path} b/${path}\nindex 0..1 100644\n--- a/${path}\n+++ b/${path}\n@@ -0,0 +1 @@\n${bigBody}`;
    // 깊고 긴 경로 30개 → 예전엔 note 가 ~900자라 budget+500 초과.
    const paths = Array.from(
      { length: 30 },
      (_, i) => `src/very/deeply/nested/directory/structure/module${i}/handler${i}.ts`,
    );
    const diff = paths.map(file).join('\n');
    const budget = 3_000;
    const r = budgetDiff(diff, budget);
    expect(r.fullySkippedPaths.length).toBeGreaterThan(10);
    expect(r.finalLength).toBeLessThanOrEqual(budget + 500); // note bound 으로 계약 유지
  });
});
