// Phase 4.5a — analyzePR 가 LLM 에 보내는 diff 텍스트의 토큰 사용량을 줄임.
//
// 핵심 룰:
// 1. diff 를 file block 단위로 분리.
// 2. lock / generated / minified / dist / build 산출물은 헤더만 남기고 본문 제외.
// 3. 위험 도메인(결제·인증·마이그레이션·보안) 파일을 먼저 포함.
// 4. 누적 문자 수가 상한에 도달하면 그 뒤 파일은 "n개 파일 생략" 으로 요약.

export const DEFAULT_DIFF_CHAR_BUDGET = 50_000;

// 본문 빼고 헤더만 보낼 파일 — lock·generated·minified·빌드 산출물.
// 본문이 길고 의미가 없어 토큰 낭비. 위험 분석에도 영향 없음.
const SKIP_BODY_PATTERNS: ReadonlyArray<RegExp> = [
  /(^|\/)package-lock\.json$/,
  /(^|\/)yarn\.lock$/,
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)Cargo\.lock$/,
  /(^|\/)poetry\.lock$/,
  /(^|\/)composer\.lock$/,
  /(^|\/)Gemfile\.lock$/,
  /\.lock$/,
  /\.min\.(js|css)$/,
  /(^|\/)dist\//,
  /(^|\/)build\//,
  /(^|\/)out\//,
  /(^|\/)\.next\//,
  /(^|\/)generated\//,
];

// 위험 도메인 키워드 — 매칭 파일은 우선 포함 + 본문 보존.
const HIGH_PRIORITY_PATTERNS: ReadonlyArray<RegExp> = [
  /payment|billing|invoice|refund/i,
  /auth(?!or)|login|session|password|credential|token/i,
  /security|crypto|encrypt|secret/i,
  /(^|\/)migrations?\//,
  /\.(sql)$/,
];

type FileBlock = {
  path: string;
  header: string;
  body: string;
  totalLength: number;
};

type FilePriority = 'high' | 'normal' | 'skip-body';

export type BudgetResult = {
  text: string;
  includedPaths: ReadonlyArray<string>;
  bodySkippedPaths: ReadonlyArray<string>;
  fullySkippedPaths: ReadonlyArray<string>;
  originalLength: number;
  finalLength: number;
};

// 전체 diff 를 file block 으로 쪼갠다. `diff --git a/x b/y` 줄로 분리.
// 첫 헤더 이전의 텍스트(거의 없음)는 첫 block 의 header 에 포함.
function splitFiles(diff: string): FileBlock[] {
  const lines = diff.split('\n');
  const blocks: FileBlock[] = [];
  let currentHeaderLines: string[] = [];
  let currentBodyLines: string[] = [];
  let currentPath: string | null = null;
  let inHeader = true;

  function flush() {
    if (currentPath === null) return;
    const header = currentHeaderLines.join('\n');
    const body = currentBodyLines.join('\n');
    blocks.push({
      path: currentPath,
      header,
      body,
      totalLength: header.length + (body ? body.length + 1 : 0),
    });
  }

  for (const line of lines) {
    const m = line.match(/^diff --git a\/(\S+) b\/(\S+)$/);
    if (m) {
      flush();
      currentPath = m[2] ?? m[1];
      currentHeaderLines = [line];
      currentBodyLines = [];
      inHeader = true;
      continue;
    }
    // 파일 헤더는 hunk(@@) 직전까지 — index/mode/+++ /-- - 등.
    if (inHeader) {
      if (line.startsWith('@@')) {
        inHeader = false;
        currentBodyLines.push(line);
      } else {
        currentHeaderLines.push(line);
      }
    } else {
      currentBodyLines.push(line);
    }
  }
  flush();
  return blocks;
}

function classify(path: string): FilePriority {
  if (SKIP_BODY_PATTERNS.some((re) => re.test(path))) return 'skip-body';
  if (HIGH_PRIORITY_PATTERNS.some((re) => re.test(path))) return 'high';
  return 'normal';
}

// 우선순위 정렬 — high → normal → skip-body. 동일 우선순위 내에선 입력 순서 보존.
function sortByPriority(blocks: FileBlock[]): FileBlock[] {
  const order: Record<FilePriority, number> = { high: 0, normal: 1, 'skip-body': 2 };
  return [...blocks]
    .map((b, i) => ({ b, p: classify(b.path), i }))
    .sort((a, b) => order[a.p] - order[b.p] || a.i - b.i)
    .map((x) => x.b);
}

// 본문 제외 시 노출할 짧은 placeholder.
function bodyOmittedNote(reason: string): string {
  return `... (${reason})`;
}

// 메인 — diff 전체를 받아 LLM 에 보낼 텍스트로 변환.
// 빈 diff 면 빈 결과.
export function budgetDiff(diff: string, charBudget = DEFAULT_DIFF_CHAR_BUDGET): BudgetResult {
  if (diff.length === 0) {
    return {
      text: '',
      includedPaths: [],
      bodySkippedPaths: [],
      fullySkippedPaths: [],
      originalLength: 0,
      finalLength: 0,
    };
  }

  const originalLength = diff.length;
  const blocks = sortByPriority(splitFiles(diff));

  const includedPaths: string[] = [];
  const bodySkippedPaths: string[] = [];
  const fullySkippedPaths: string[] = [];
  const out: string[] = [];
  let used = 0;

  for (const block of blocks) {
    const priority = classify(block.path);

    // skip-body — header 만 (lock 파일 등). 본문은 한 줄 placeholder.
    if (priority === 'skip-body') {
      const note = bodyOmittedNote(`본문 생략: lock · 빌드 산출물 (${block.body.length} chars)`);
      const piece = `${block.header}\n${note}`;
      if (used + piece.length > charBudget) {
        fullySkippedPaths.push(block.path);
        continue;
      }
      out.push(piece);
      used += piece.length + 1;
      bodySkippedPaths.push(block.path);
      continue;
    }

    // 전체 block 통째로 들어갈 수 있으면 그대로 추가.
    if (used + block.totalLength <= charBudget) {
      out.push(block.header);
      if (block.body) out.push(block.body);
      used += block.totalLength + 1;
      includedPaths.push(block.path);
      continue;
    }

    // 한 block 이 너무 커 한 번에 못 넣으면 header 만 살리고 body 잘림 표시.
    // 단 header 도 못 들어가면 그 파일은 통째로 생략.
    const headerOnly = `${block.header}\n${bodyOmittedNote(
      `본문 잘림: 토큰 예산 초과 (${block.body.length} chars)`,
    )}`;
    if (used + headerOnly.length <= charBudget) {
      out.push(headerOnly);
      used += headerOnly.length + 1;
      bodySkippedPaths.push(block.path);
    } else {
      fullySkippedPaths.push(block.path);
    }
  }

  if (fullySkippedPaths.length > 0) {
    out.push(bodyOmittedNote(`${fullySkippedPaths.length}개 파일 전체 생략 (토큰 예산 초과)`));
  }

  const text = out.join('\n');
  return {
    text,
    includedPaths,
    bodySkippedPaths,
    fullySkippedPaths,
    originalLength,
    finalLength: text.length,
  };
}
