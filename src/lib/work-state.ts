// Phase 16 — .cortex/work-state.md 파서 + 직렬화 (세션 연속성).
//
// 디자인 결정:
// - 새 라이브러리 추가 없이 자체 mini markdown 파서 구현 (project-meta.ts 의 roadmap 파서 스타일).
//   schema v1 의 단순 구조 한정.
// - 새 세션(메모리 없는 에이전트/사람)이 README → AGENTS 다음으로 읽어, 진행 중 작업·다음
//   단계·맥락을 git log 에서 비싸게 재추론하지 않게 하는 머신 파서블 기록.
// - 파서는 관대(malformed-tolerant): 알 수 없는 섹션·빈 섹션·없는 섹션 모두 허용, HTML 주석 무시.
// - 로드맵 체크박스는 여기서 다루지 않음 (그건 .cortex/roadmap.md / docs/ROADMAP.md).

// ============================================================================
// work-state schema v1
// ============================================================================

export type WorkStateItem = {
  // "<항목>" — 진행 중 브랜치/PR 이름 등.
  item: string;
  // "<한 줄 상태>" — 항목 뒤 콜론 다음. 없으면 빈 문자열.
  status: string;
};

export type WorkStateV1 = {
  // `## 진행 중` — 진행 중 브랜치/PR + 한 줄 상태.
  inProgress: WorkStateItem[];
  // `## 다음 단계` — 다음 할 일 (한 줄씩).
  nextSteps: string[];
  // `## 메모` — 맥락/주의 (한 줄씩).
  notes: string[];
};

// 인식하는 섹션 헤딩 → WorkStateV1 키 매핑. 그 외 헤딩은 무시(관대).
const SECTION_IN_PROGRESS = '진행 중';
const SECTION_NEXT_STEPS = '다음 단계';
const SECTION_NOTES = '메모';

// ============================================================================
// 파서
// ============================================================================

// `## 진행 중` 같은 섹션 헤딩에서 제목을 추출. 아니면 null.
function matchSectionHeading(line: string): string | null {
  const m = line.match(/^##\s+(.+?)\s*$/);
  return m ? m[1].trim() : null;
}

// `- text` 리스트 아이템에서 본문 추출. 아니면 null.
function matchListItem(line: string): string | null {
  const m = line.match(/^\s*-\s+(.*)$/);
  if (!m) return null;
  return m[1].trim();
}

// "<항목>: <상태>" 분리. 첫 콜론 기준 (한글 콜론 X, ascii ':' 만). 콜론 없으면 status=''.
function splitItemStatus(text: string): WorkStateItem {
  const idx = text.indexOf(':');
  if (idx < 0) return { item: text.trim(), status: '' };
  return {
    item: text.slice(0, idx).trim(),
    status: text.slice(idx + 1).trim(),
  };
}

// HTML 주석(<!-- ... -->, 멀티라인 포함) 제거.
function stripHtmlComments(content: string): string {
  return content.replace(/<!--[\s\S]*?-->/g, '');
}

// work-state.md 파싱. 항상 WorkStateV1 반환 (관대 — 에러 throw 안 함).
// 인식 못 한 섹션·빈 섹션·없는 섹션은 무시. 빈 항목 줄은 스킵.
export function parseWorkState(content: string): WorkStateV1 {
  const ws: WorkStateV1 = { inProgress: [], nextSteps: [], notes: [] };
  const lines = stripHtmlComments(content).split(/\r?\n/);

  // current = 지금 채우는 섹션 키. 인식 못 한 섹션이면 null (수집 안 함).
  let current: keyof WorkStateV1 | null = null;

  for (const rawLine of lines) {
    const heading = matchSectionHeading(rawLine);
    if (heading !== null) {
      if (heading === SECTION_IN_PROGRESS) current = 'inProgress';
      else if (heading === SECTION_NEXT_STEPS) current = 'nextSteps';
      else if (heading === SECTION_NOTES) current = 'notes';
      else current = null;
      continue;
    }
    if (current === null) continue;

    const itemText = matchListItem(rawLine);
    if (itemText === null || itemText.length === 0) continue;

    if (current === 'inProgress') {
      ws.inProgress.push(splitItemStatus(itemText));
    } else {
      ws[current].push(itemText);
    }
  }

  return ws;
}

// ============================================================================
// 직렬화 (round-trip safe)
// ============================================================================

const HEADER = `<!--
work-state schema v1 — 세션 연속성용 작업 상태 파일 (Phase 16)

이 파일은 사람과 에이전트가 공용으로 읽는, 머신 파서블한 "지금 작업 상태" 기록입니다.
새 세션(메모리 없는 에이전트/사람)이 README → AGENTS 다음으로 읽어, 진행 중 작업·
다음 단계·맥락을 git log 에서 비싸게 재추론하지 않고 바로 파악하도록 합니다.

규칙 (최소 schema):
- 섹션은 \`## \` 헤딩. 인식: \`## ${SECTION_IN_PROGRESS}\` / \`## ${SECTION_NEXT_STEPS}\` / \`## ${SECTION_NOTES}\`.
- \`## ${SECTION_IN_PROGRESS}\` 줄은 \`- <항목>: <한 줄 상태>\` (콜론 뒤가 상태, 없으면 상태 빈 항목).
- 그 외 두 섹션은 \`- <한 줄>\`. 알 수 없는/빈/없는 섹션은 무시(관대).

파서: src/lib/work-state.ts (의존성 없는 자체 mini 파서, schema v1 한정).
-->

# work-state

Cortex 자체의 단기 작업 상태. 새 세션은 README → AGENTS → 이 파일 순으로 읽으세요.`;

// WorkStateV1 → markdown. parseWorkState(serializeWorkState(ws)) 가 ws 와 동등(round-trip safe).
// 빈 섹션도 헤딩은 출력 (스키마 가시성). 항목 status 가 있으면 "항목: 상태", 없으면 "항목".
export function serializeWorkState(ws: WorkStateV1): string {
  const blocks: string[] = [HEADER];

  const inProgressLines = ws.inProgress.map((it) =>
    it.status.length > 0 ? `- ${it.item}: ${it.status}` : `- ${it.item}`,
  );
  blocks.push([`## ${SECTION_IN_PROGRESS}`, '', ...inProgressLines].join('\n'));

  blocks.push([`## ${SECTION_NEXT_STEPS}`, '', ...ws.nextSteps.map((s) => `- ${s}`)].join('\n'));

  blocks.push([`## ${SECTION_NOTES}`, '', ...ws.notes.map((s) => `- ${s}`)].join('\n'));

  // 블록 사이 빈 줄 2개(헤딩 앞 간격) + 끝 개행 1개.
  return blocks.join('\n\n') + '\n';
}
