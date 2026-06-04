import { describe, expect, it } from 'vitest';
import { attachCommentsToFiles, parseUnifiedDiff } from './diff-parser';

const SAMPLE_DIFF = `diff --git a/src/foo.ts b/src/foo.ts
index 1111111..2222222 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,5 +1,6 @@
 const x = 1;
-const y = 2;
+const y = 3;
+const z = 4;
 const w = 5;
diff --git a/src/bar.ts b/src/bar.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/src/bar.ts
@@ -0,0 +1,2 @@
+export const hello = 'world';
+export const num = 42;
`;

describe('parseUnifiedDiff', () => {
  it('parses two files with hunks', () => {
    const files = parseUnifiedDiff(SAMPLE_DIFF);
    expect(files.map((f) => f.path)).toEqual(['src/foo.ts', 'src/bar.ts']);
  });

  it('counts additions and deletions per file', () => {
    const files = parseUnifiedDiff(SAMPLE_DIFF);
    const foo = files.find((f) => f.path === 'src/foo.ts');
    expect(foo?.additions).toBe(2);
    expect(foo?.deletions).toBe(1);

    const bar = files.find((f) => f.path === 'src/bar.ts');
    expect(bar?.additions).toBe(2);
    expect(bar?.deletions).toBe(0);
  });

  it('classifies lines by kind (ctx/add/del/hunk-head)', () => {
    const files = parseUnifiedDiff(SAMPLE_DIFF);
    const fooHunk = files[0].hunks[0];
    if (fooHunk.kind !== 'expanded') throw new Error('expected expanded hunk');
    const kinds = fooHunk.lines.map((l) => l.kind);
    expect(kinds).toEqual(['hunk-head', 'ctx', 'del', 'add', 'add', 'ctx']);
  });

  it('assigns line numbers from hunk header', () => {
    const files = parseUnifiedDiff(SAMPLE_DIFF);
    const fooHunk = files[0].hunks[0];
    if (fooHunk.kind !== 'expanded') throw new Error('expected expanded hunk');
    // @@ -1,5 +1,6 @@ → new side starts at 1
    const addLines = fooHunk.lines.filter((l) => l.kind === 'add');
    expect(addLines.map((l) => l.lineNumber)).toEqual([2, 3]);
  });

  it('ignores binary and rename headers', () => {
    const diff = `diff --git a/img.png b/img.png
Binary files a/img.png and b/img.png differ
diff --git a/old.txt b/new.txt
similarity index 95%
rename from old.txt
rename to new.txt
`;
    const files = parseUnifiedDiff(diff);
    // 두 파일 모두 hunk 없는 빈 FileBlock 으로 만들어짐.
    expect(files).toHaveLength(2);
    expect(files[0].hunks).toHaveLength(0);
  });

  it('returns empty array for empty input', () => {
    expect(parseUnifiedDiff('')).toEqual([]);
  });

  // 회귀(리뷰 발견): hunk 안에서 `-- `/`++ ` 로 시작하는 줄을 삭제/추가한 content line(raw
  // `--- `/`+++ `)을 파일 헤더로 오인해 버리던 버그. 헤더 skip 은 첫 hunk 전에만 적용해야 함.
  it('hunk 안의 `--- `/`+++ ` content line 을 헤더로 오인해 버리지 않음', () => {
    // SQL 주석 `-- old comment` 삭제 + `++ counter` 추가 → raw diff 에서 `--- `/`+++ ` 로 시작.
    const diff = `diff --git a/q.sql b/q.sql
index 111..222 100644
--- a/q.sql
+++ b/q.sql
@@ -1,3 +1,3 @@
 SELECT 1;
-- old comment
++ counter
 SELECT 2;
`;
    const files = parseUnifiedDiff(diff);
    expect(files).toHaveLength(1);
    const hunk = files[0].hunks[0];
    expect(hunk.kind).toBe('expanded');
    if (hunk.kind !== 'expanded') return;
    // 삭제 줄(content `- old comment`)·추가 줄(content `+ counter`)이 보존돼야.
    const del = hunk.lines.find((l) => l.kind === 'del');
    const add = hunk.lines.find((l) => l.kind === 'add');
    expect(del?.text).toBe('- old comment');
    expect(add?.text).toBe('+ counter');
    // 카운트도 정확.
    expect(files[0].deletions).toBe(1);
    expect(files[0].additions).toBe(1);
  });

  it('파일 헤더 `--- a/x`/`+++ b/x` 는 (첫 hunk 전이라) 여전히 무시', () => {
    const diff = `diff --git a/x.txt b/x.txt
index 111..222 100644
--- a/x.txt
+++ b/x.txt
@@ -1 +1 @@
-a
+b
`;
    const files = parseUnifiedDiff(diff);
    expect(files).toHaveLength(1);
    // 헤더가 content 로 새지 않았는지 — 줄은 hunk-head + del + add 3개뿐.
    const hunk = files[0].hunks[0];
    if (hunk.kind !== 'expanded') throw new Error('expanded expected');
    expect(hunk.lines.filter((l) => l.kind === 'del')).toHaveLength(1);
    expect(hunk.lines.filter((l) => l.kind === 'add')).toHaveLength(1);
    expect(files[0].deletions).toBe(1);
    expect(files[0].additions).toBe(1);
  });
});

describe('attachCommentsToFiles', () => {
  it('attaches comment to the hunk whose line range contains it', () => {
    const files = parseUnifiedDiff(SAMPLE_DIFF);
    const withComments = attachCommentsToFiles(files, [
      { path: 'src/foo.ts', line: 3, body: '여기 z 도입 의도 확인 필요' },
    ]);

    const foo = withComments.find((f) => f.path === 'src/foo.ts');
    const hunk = foo?.hunks[0];
    if (hunk?.kind !== 'expanded') throw new Error('expected expanded hunk');
    expect(hunk.aiComment).toContain('L3');
    expect(hunk.aiComment).toContain('z 도입');
    expect(foo?.status).toBe('warn');
  });

  it('groups multiple comments on the same hunk', () => {
    const files = parseUnifiedDiff(SAMPLE_DIFF);
    const withComments = attachCommentsToFiles(files, [
      { path: 'src/foo.ts', line: 2, body: 'first' },
      { path: 'src/foo.ts', line: 3, body: 'second' },
    ]);

    const foo = withComments.find((f) => f.path === 'src/foo.ts');
    const hunk = foo?.hunks[0];
    if (hunk?.kind !== 'expanded') throw new Error('expected expanded hunk');
    expect(hunk.aiComment).toContain('first');
    expect(hunk.aiComment).toContain('second');
  });

  it('leaves status unchanged when no comment matches', () => {
    const files = parseUnifiedDiff(SAMPLE_DIFF);
    const withComments = attachCommentsToFiles(files, [
      { path: 'src/missing.ts', line: 1, body: 'orphan' },
    ]);
    expect(withComments.find((f) => f.path === 'src/foo.ts')?.status).toBe('ok');
  });

  it('returns original files when comments array is empty', () => {
    const files = parseUnifiedDiff(SAMPLE_DIFF);
    const result = attachCommentsToFiles(files, []);
    expect(result).toEqual(files);
  });
});
