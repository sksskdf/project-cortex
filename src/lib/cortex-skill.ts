// Phase 13.6 — Cortex 워크플로 방법론을 claude code 스킬로 박제.
// 사용자의 ~/.claude/skills/cortex/SKILL.md 로 설치하면 모든(전역) claude 세션에서
// on-demand 로 로드 가능 — 불러온 프로젝트에서 작업할 때 Cortex 컨벤션을 일관되게 따른다.
// 동적 상태(현재 로드맵·이슈)는 cortex-context.ts 가 세션 시작 prompt 에 주입.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

// SKILL.md — frontmatter(name/description) + 본문(방법론). 본문은 CLAUDE.md·AGENTS 컨벤션 요약.
export const CORTEX_SKILL_CONTENT = `---
name: cortex
description: >-
  Cortex 가 관리하는 레포에서 작업할 때의 워크플로·컨벤션. 커밋 트레일러, 로드맵 자동 done
  컨벤션(Closes #PHASE-/#ITEM-), .cortex 메타 디렉토리, 지정 브랜치 개발, PR 생성·검증 규칙.
  불러온 프로젝트에서 Cortex 흐름에 맞춰 작업할 때 사용.
---

# Cortex 워크플로

Cortex 는 에이전트가 코드를 쓰고 사람은 핵심 결정만 하는 PR 자동 리뷰·머지 + 이슈 위임 툴이다.
Cortex 가 관리하는 레포에서 작업할 때 아래 컨벤션을 따른다.

## 시작 시

- 레포 루트의 \`.cortex/roadmap.md\` 를 먼저 읽는다 — Phase·산출물(deliverable) 진척이 구조화돼 있다.
- \`.cortex/project.yml\` 이 있으면 프로젝트 정책(자동 머지·자동 수정 토글 등)을 확인한다.
- 위임된 이슈가 있으면 그 spec(수용 기준)을 작업 범위의 기준으로 삼는다.

## 작업 중

- 요청 범위만 구현한다. 불필요한 리팩터링·추상화·미래 대비 코드를 더하지 않는다.
- 기존 파일 편집을 우선한다. 새 파일·문서(*.md)는 꼭 필요할 때만.
- 주석은 "왜"가 비자명할 때만. 무엇을 하는지는 코드가 말하게 한다.

## 커밋 · 검증 · PR

- 의미 있는 단위로 커밋한다. 커밋 메시지는 "왜"에 초점.
- PR 을 만들기 전에 typecheck · 포매터(prettier 등) · 전체 테스트를 돌려 실패를 모두 고친다.
- 작업이 끝나면 커밋 + 푸시 + PR 생성까지 한다 (커밋만 하고 끝내지 않는다).
- 지정된 개발 브랜치에서 작업하고, 별도 지시 없이 다른 브랜치로 푸시하지 않는다.

## 로드맵 자동 done 컨벤션

PR 본문에 아래 형식을 적으면 머지 시 해당 항목이 자동으로 done 처리된다.

- Phase 완료: \`Closes #PHASE-<키>\` (키는 roadmap.md 의 Phase 키)
- 산출물 완료: \`Closes #ITEM-<id>\`

## 안전

- 되돌리기 어렵거나 공유 상태에 영향을 주는 작업(force push, reset --hard, 브랜치 삭제,
  배포 등)은 먼저 사람에게 확인한다.
- 훅을 건너뛰거나(\`--no-verify\`) 서명을 우회하지 않는다 — 실패하면 원인을 고친다.
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
