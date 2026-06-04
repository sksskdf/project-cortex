// Unified diff 파서 — getPRDiff 가 받아오는 텍스트를 FileBlock[] 구조로 변환.
// LLM 코멘트는 path+line 으로 매칭해서 hunk 의 reason 에 부착.
//
// 파싱 범위는 GitHub 의 git diff 형식만 — `diff --git`, `@@ -a,b +c,d @@`,
// `+`/`-`/` ` 접두사. binary diff 와 mode change 는 무시(빈 hunk 로 처리).

import type { PreReviewComment } from '@/db/schema';
import type { CodeLine, FileBlock, FileStatus, Hunk } from '@/lib/types';

// 내부 가변 hunk 타입 — push 로 lines 누적. 완성되면 Hunk(readonly lines) 로 캐스팅.
type MutableExpandedHunk = {
  kind: 'expanded';
  id: string;
  reason: { text: string; tone: 'alert' | 'warn' | 'info' };
  lines: CodeLine[];
  aiComment?: string;
};

const FILE_HEADER = /^diff --git a\/(.+) b\/(.+)$/;
const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/;

export function parseUnifiedDiff(diff: string): FileBlock[] {
  const files: FileBlock[] = [];
  const lines = diff.split('\n');

  let currentFile: {
    path: string;
    hunks: MutableExpandedHunk[];
    additions: number;
    deletions: number;
  } | null = null;
  let currentHunk: MutableExpandedHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  const flushFile = () => {
    if (!currentFile) return;
    const status: FileStatus =
      currentFile.deletions > 0 && currentFile.additions === 0 ? 'warn' : 'ok';
    files.push({
      path: currentFile.path,
      status,
      additions: currentFile.additions,
      deletions: currentFile.deletions,
      hunks: currentFile.hunks,
    });
    currentFile = null;
  };

  for (const line of lines) {
    const fileMatch = line.match(FILE_HEADER);
    if (fileMatch) {
      flushFile();
      currentFile = {
        path: fileMatch[2] ?? fileMatch[1] ?? 'unknown',
        hunks: [],
        additions: 0,
        deletions: 0,
      };
      currentHunk = null;
      continue;
    }

    // index / mode / --- / +++ 파일 헤더는 **첫 hunk 전(currentHunk===null)** 에만 등장한다.
    // 이 가드가 없으면, hunk 안에서 `-- ` 로 시작하는 줄을 **삭제**한 content line(raw `--- ...`)
    // 이나 `++ ` 로 시작하는 줄을 추가한 content line(raw `+++ ...`)을 파일 헤더로 오인해 통째로
    // 버린다 → 삭제/추가 줄이 hunk·카운트에서 누락(리뷰 발견. 예: SQL/Lua 주석 `-- note`·
    // 이메일 서명 `-- ` 삭제). hunk 진입 후엔 +/-/space content 로만 처리.
    if (
      currentHunk === null &&
      (line.startsWith('index ') ||
        line.startsWith('new file ') ||
        line.startsWith('deleted file ') ||
        line.startsWith('similarity index') ||
        line.startsWith('rename ') ||
        line.startsWith('Binary files') ||
        line.startsWith('--- ') ||
        line.startsWith('+++ '))
    ) {
      continue;
    }

    const hunkMatch = line.match(HUNK_HEADER);
    if (hunkMatch) {
      oldLine = parseInt(hunkMatch[1], 10);
      newLine = parseInt(hunkMatch[2], 10);
      const headerSuffix = hunkMatch[3]?.trim() ?? '';
      currentHunk = {
        kind: 'expanded',
        id: `${currentFile?.path ?? 'file'}:${newLine}`,
        reason: { text: headerSuffix || '코드 변경', tone: 'info' },
        lines: [{ lineNumber: null, text: line, kind: 'hunk-head' }],
      };
      currentFile?.hunks.push(currentHunk);
      continue;
    }

    if (!currentHunk || !currentFile) continue;

    if (line.startsWith('+')) {
      currentHunk.lines.push({ lineNumber: newLine, text: line.slice(1), kind: 'add' });
      newLine++;
      currentFile.additions++;
    } else if (line.startsWith('-')) {
      currentHunk.lines.push({ lineNumber: oldLine, text: line.slice(1), kind: 'del' });
      oldLine++;
      currentFile.deletions++;
    } else if (line.startsWith(' ')) {
      currentHunk.lines.push({ lineNumber: newLine, text: line.slice(1), kind: 'ctx' });
      oldLine++;
      newLine++;
    } else if (line.startsWith('\\')) {
      // "\ No newline at end of file" — 무시.
      continue;
    }
  }
  flushFile();

  return files;
}

// LLM 인라인 코멘트를 hunk 에 부착 — 각 hunk 의 라인 범위 안에 떨어지면 그 hunk 의
// aiComment 에 추가. 어디에도 못 붙으면 코멘트 없는 hunk 그대로 둠.
export function attachCommentsToFiles(
  files: ReadonlyArray<FileBlock>,
  comments: ReadonlyArray<PreReviewComment>,
): FileBlock[] {
  if (comments.length === 0) return [...files];

  return files.map((file): FileBlock => {
    const fileComments = comments.filter((c) => c.path === file.path);
    if (fileComments.length === 0) return file;

    const updatedHunks: Hunk[] = file.hunks.map((hunk): Hunk => {
      if (hunk.kind !== 'expanded') return hunk;
      // hunk 의 라인 번호 범위 (new 사이드 기준).
      const lineNums = hunk.lines
        .filter((l) => l.kind === 'add' || l.kind === 'ctx')
        .map((l) => l.lineNumber)
        .filter((n): n is number => n !== null);
      if (lineNums.length === 0) return hunk;
      const minLine = Math.min(...lineNums);
      const maxLine = Math.max(...lineNums);

      const matching = fileComments.filter((c) => c.line >= minLine && c.line <= maxLine);
      if (matching.length === 0) return hunk;

      const aiComment = matching.map((c) => `**L${c.line}**: ${c.body}`).join('\n\n');
      return { ...hunk, aiComment };
    });

    const hasComments = updatedHunks.some(
      (h) => h.kind === 'expanded' && typeof h.aiComment === 'string',
    );
    return {
      ...file,
      status: hasComments ? 'warn' : file.status,
      hunks: updatedHunks,
    };
  });
}
