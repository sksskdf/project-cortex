// Phase 13.6 — Cortex 워크플로 방법론을 claude code 스킬로 박제.
// 사용자의 ~/.claude/skills/cortex/SKILL.md 로 설치하면 모든(전역) claude 세션에서
// on-demand 로 로드 가능 — 불러온 프로젝트에서 작업할 때 Cortex 컨벤션을 일관되게 따른다.
// 동적 상태(현재 로드맵·이슈)는 cortex-context.ts 가 세션 시작 prompt 에 주입.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

// SKILL.md — frontmatter(name/description) + 본문(방법론·스키마). 사용자 시그널(2026-06-01):
// "다른 프로젝트에서 cortex 작업 시 cortex 에 대한 정보가 없음" — 로드맵/project.yml/work-state
// 형식 스키마와 .cortex 디렉토리 구조를 명시해 위임된 에이전트가 추측 없이 따를 수 있게 보강.
export const CORTEX_SKILL_CONTENT = `---
name: cortex
description: >-
  Cortex 가 관리하는 레포에서 작업할 때의 워크플로·컨벤션·.cortex 디렉토리 스키마. 로드맵
  자동 done 규칙(Closes #PHASE-/#ITEM-), roadmap.md/project.yml/work-state.md 의 정확한
  형식, 커밋·PR·브랜치 규칙. 불러온 Cortex 프로젝트에서 작업할 때 항상 참조.
---

# Cortex 워크플로

Cortex 는 에이전트가 코드를 쓰고 사람은 핵심 결정만 하는 PR 자동 리뷰·머지 + 이슈 위임 툴이다.
Cortex 가 관리하는 레포에서 작업할 때 아래 컨벤션을 따른다.

## 시작 시 — \`.cortex/\` 메타 디렉토리

\`.cortex/\` 는 Cortex 가 파싱하는 구조화 메타. 작업 시작 전 다음을 확인한다.

- \`.cortex/roadmap.md\` — Phase·산출물(deliverable) 진척. 형식은 아래 "로드맵 스키마" 참조.
- \`.cortex/project.yml\` — 프로젝트 정책(자동 머지·자동 수정 토글 등). "project.yml 스키마" 참조.
- \`.cortex/work-state.md\` (있으면) — 진행 중 브랜치/PR + 다음 단계 + 맥락 메모. 새 세션이 git log
  대신 빠르게 따라잡기 위한 머신 파서블 기록. "work-state 스키마" 참조.
- 위임된 이슈가 있으면 그 spec(수용 기준)을 작업 범위의 기준으로 삼는다.

## 작업 중

- 요청 범위만 구현한다. 불필요한 리팩터링·추상화·미래 대비 코드를 더하지 않는다.
- 기존 파일 편집을 우선한다. 새 파일·문서(*.md)는 꼭 필요할 때만.
- 주석은 "왜"가 비자명할 때만. 무엇을 하는지는 코드가 말하게 한다.
- 주변 코드의 스타일·네이밍·구조를 따른다.

## 커밋 · 검증 · PR

- 의미 있는 단위로 커밋한다. 커밋 메시지는 "왜"에 초점.
- PR 을 만들기 전에 typecheck · 포매터(prettier 등) · 전체 테스트를 돌려 실패를 모두 고친다.
- 작업이 **완전히 끝난 후** 커밋 + 푸시 + PR 생성. PR 생성 후 같은 branch 에 commit 추가하지
  않는다 (자동 머지 race 로 commit 누락 위험). 추가 작업 필요하면 별도 branch + 별도 PR.
- 지정된 개발 브랜치에서 작업하고, 별도 지시 없이 다른 브랜치로 푸시하지 않는다.

## 자동 머지 활성 신호 (필수)

Cortex 의 자동 머지는 "작업 완료" 가 명시된 PR 만 대상. 두 신호 중 하나라도 만족해야 자동 머지
큐 진입:

1. **PR draft 해제** — GitHub UI 에서 "Ready for review" 클릭. 사람 PR 의 표준.
2. **마지막 commit message 의 trailer \`Cortex: ready\`** — agent 가 push 만으로 신호 가능:

   \`\`\`
   feat: 작업 마무리

   변경 요약 …

   Cortex: ready
   \`\`\`

둘 다 없으면 트라이지가 \`human-review\` 결정 → 사용자가 수동 머지 가능. agent 가 위임 작업을
마무리할 때는 **마지막 commit 에 trailer 를 박는다**(또는 PR draft 해제).

## 로드맵 자동 done 컨벤션 (필수)

PR 본문에 아래 형식을 적으면 머지 시 해당 항목이 자동으로 done 처리된다.

- **Phase 완료**: \`Closes #PHASE-<키>\` (예: \`Closes #PHASE-13.6\`)
- **산출물 완료**: \`Closes #ITEM-<id>\` (예: \`Closes #ITEM-42\`)

키 형식: 영숫자·하이픈·언더스코어 + 점 구분(\`4.7\`·\`13.6\` 등) 허용. 끝의 문장부호(\`.\`)는
키에 포함 안 됨. 부모 키(\`13\`)와 자식 키(\`13.6\`)는 별개로 매칭.

# .cortex 스키마

## 로드맵 스키마 — \`.cortex/roadmap.md\`

Cortex UI 가 파싱하는 구조. 정확히 다음 형식이어야 한다.

### Phase 헤더

\`\`\`markdown
## Phase <키> — <제목>
\`\`\`

- 키: 영숫자·하이픈·언더스코어 + 점 구분 가능 (예: \`0\`, \`13.6\`, \`R-1\`).
- 구분자는 em-dash(\`—\`) 또는 hyphen(\`-\`) 둘 다 허용. 제목 생략 시 키가 제목이 됨.
- 같은 키가 두 번 등장하면 첫 번째만 채택(파서는 관대).

예:

\`\`\`markdown
## Phase 0 — 스캐폴딩
## Phase 13.6 — claude CLI 최신 활용 (리서치·고도화)
\`\`\`

### Phase 목표(goal) 영역

헤더 다음, **첫 항목 리스트 직전**까지의 빈 줄 아닌 라인이 goal 로 모임(여러 줄 OK).

\`\`\`markdown
## Phase 5 — 트라이아지 엔진

엔진의 책임·기준·결정 흐름 요약.

- [x] 첫 항목
\`\`\`

### 산출물(item) 체크박스

\`\`\`markdown
- [x] 완료된 산출물 설명 — 부연 (#PR번호 등 추가 메타)
- [ ] 미완료 산출물 설명
\`\`\`

- \`[x]\` 또는 \`[X]\` = done, \`[ ]\` = 미완료.
- 본문은 한 줄(또는 들여쓴 연속 줄도 본문 첫 줄 기준으로 처리). PR 번호·근거 등을 같은 줄에 둠.
- 들여쓴 sub-list 는 별도 산출물이 아니라 본문 일부로 처리.

### 상태 enum

Cortex 가 추적하는 항목 상태(파서가 만들어내는 값): \`done\`(=\`[x]\`) 또는 \`open\`(=\`[ ]\`).
**(done)/(in-progress)/(todo) 같은 인라인 상태 표기는 파서가 인식하지 못한다** —
체크박스 마크가 단일 source of truth.

## project.yml 스키마 — \`.cortex/project.yml\`

Schema v1. yaml subset(이 파서는 anchor/alias/flow-style 미지원, key:value/nested object/list만).

\`\`\`yaml
schema: 1
name: my-project
slug: owner/repo            # GitHub slug (자동 sync 키)
description: ...
kind: app                   # 자유
status: active              # 자유
domain: ...
owners:
  - alice
  - bob
tech:
  language: TypeScript
  framework: Next.js
  database: SQLite
links:
  homepage: https://...
  docs: https://...
  issue_tracker: https://...
\`\`\`

> **자동화 토글은 git sync 대상이 아니다.** auto_merge·ai_review·auto_resolve_changes·
> auto_resolve_conflicts·auto_fix_tests·muted 등 운영 토글은 **로컬 DB 전용**(Cortex UI 의
> /projects 카드에서만 설정·반영). 머신마다 다를 수 있고 git 에 박제할 정책이 아니라,
> project.yml 에 automation 블록을 둬도 무시된다. 서술 메타(name·description·kind·domain·
> links)만 git → Cortex 로 동기화된다.

## work-state 스키마 — \`.cortex/work-state.md\`

세션 연속성용 머신 파서블 기록. **인식 섹션만 채워진다 — 그 외 헤딩은 무시(관대).**

### 인식 섹션 (정확히 이 제목)

\`\`\`markdown
## 진행 중

- <항목>: <한 줄 상태>
- <항목>

## 다음 단계

- 다음 할 일 한 줄
- ...

## 메모

- 맥락/주의 한 줄
- ...
\`\`\`

- \`## 진행 중\` 의 항목은 \`<항목>: <상태>\` 형식 (ascii 콜론 \`:\` 만). 콜론 없으면 status="".
- HTML 주석(\`<!-- ... -->\`)은 멀티라인 포함 제거됨.
- 알 수 없는 섹션·빈 섹션·없는 섹션 모두 허용.

# 안전

- 되돌리기 어렵거나 공유 상태에 영향을 주는 작업(force push, reset --hard, 브랜치 삭제,
  배포 등)은 먼저 사람에게 확인한다.
- 훅을 건너뛰거나(\`--no-verify\`) 서명을 우회하지 않는다 — 실패하면 원인을 고친다.
- 워크스페이스(레포 클론) 외부 경로를 건드리지 않는다. Cortex 가 화이트리스트로 관리.
`;

// R2 (Phase 13.6) — 헤드리스 코딩 자동화(test-fix·conflict-resolve·review-fix)에 일관 주입하는
// Cortex 가드레일. 슬래시 스킬(`/cortex` 등)은 `-p` 헤드리스에서 안 먹으므로, 시스템 프롬프트
// (`--append-system-prompt-file`)로 방법론을 전역 적용한다. 이들은 좁은 자동 수정 작업이고
// git/PR 은 하네스가 관리하므로, 전체 위임용 스킬(PR 생성·로드맵 컨벤션 등)이 아니라 범위·안전
// 규칙만 담는다. 멀티턴(테스트 재실행→수정 반복)에도 시스템 프롬프트라 일관 유지된다.
export const CORTEX_HEADLESS_GUIDANCE = `# Cortex 작업 가드레일

이 작업은 Cortex 가 관리하는 레포의 자동 수정 작업입니다. 다음을 지키세요.

- 주어진 작업 범위만 해결하세요. 불필요한 리팩터링·추상화·미래 대비 코드를 더하지 마세요.
- 새 파일·문서보다 기존 파일 편집을 우선하세요. 주석은 "왜"가 비자명할 때만.
- 주변 코드의 스타일·네이밍·구조를 따르세요.
- 되돌리기 어려운 git 작업(force push, reset --hard, 브랜치 삭제, 히스토리 재작성)이나
  훅 우회(--no-verify)·서명 우회는 하지 마세요. 커밋·푸시는 하네스가 관리합니다.
`;

export function cortexSkillPath(): string {
  return join(homedir(), '.claude', 'skills', 'cortex', 'SKILL.md');
}

export type InstallSkillResult =
  | { kind: 'installed'; path: string }
  | { kind: 'up-to-date'; path: string };

// 멱등 설치 — 내용이 같으면 다시 쓰지 않는다. ~/.claude/skills/cortex/SKILL.md 에 기록.
export function installCortexSkill(): InstallSkillResult {
  const path = cortexSkillPath();
  if (existsSync(path)) {
    try {
      if (readFileSync(path, 'utf8') === CORTEX_SKILL_CONTENT) {
        return { kind: 'up-to-date', path };
      }
    } catch {
      // 읽기 실패 시 재기록으로 진행.
    }
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, CORTEX_SKILL_CONTENT, 'utf8');
  return { kind: 'installed', path };
}
