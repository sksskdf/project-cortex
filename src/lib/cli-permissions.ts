// Phase 13.5 R4 — claude CLI 자동화 헤드리스 호출의 작업별 좁은 도구 허용목록.
//
// `--dangerously-skip-permissions`(전부 허용) 대신, 각 자동화 작업에 실제로 필요한 도구만 명시
// 허용. 잘못된 자동 명령 실행·예상 외 도구 사용을 줄여 자동화 동작을 예측 가능하게 만든다.
//
// 운영 모델 (opt-in):
//   settings.cliAllowedToolsEnabled === false → 기존 `--dangerously-skip-permissions` 유지(무회귀).
//   settings.cliAllowedToolsEnabled === true  → 아래 ALLOWLISTS 에서 작업별 목록 적용.
// 사용자가 머신에서 1회 검증 후 켜라(허용 목록 형식·이름이 CLI 와 정확히 일치해야 동작).
//
// 검증 방법:
//   1) settings.cliAllowedToolsEnabled = true 로 설정.
//   2) 실 PR 에 자동 수정 트리거(test-fix·conflict-resolve·review-fix) 발생시켜 정상 동작 확인.
//   3) 동작 안 하면 OFF 로 즉시 복귀. CLI 의 실제 도구 이름·표현(예: `Bash(npm test)`) 확인 후 갱신.

export type AutomationTask = 'test-fix' | 'conflict-resolve' | 'review-fix';

// 작업별 최소 허용 도구. 표준 도구 이름(claude code 컨벤션) 기준:
//   Read · Edit · Write · Grep · Glob · Bash · NotebookEdit
//
// **포함 안 함** (의도적): WebFetch · WebSearch · Task(sub-agent spawn) · MCP 도구. 자동화에 불필요.
const ALLOWLISTS: Record<AutomationTask, ReadonlyArray<string>> = {
  // 테스트 수정 — 실패 분석(Read/Grep/Glob) + 코드 고치기(Edit/Write) + 테스트 실행(Bash).
  'test-fix': ['Read', 'Edit', 'Write', 'Grep', 'Glob', 'Bash'],
  // 충돌 해결 — 마커 해소는 파일 편집만 필요. git 명령은 호출자 쪽(외부)에서 실행이라 Bash 불요.
  'conflict-resolve': ['Read', 'Edit', 'Write', 'Grep', 'Glob'],
  // 리뷰 반영 — 코멘트 적용은 코드 편집 + 필요시 테스트 재실행.
  'review-fix': ['Read', 'Edit', 'Write', 'Grep', 'Glob', 'Bash'],
};

export function allowedToolsFor(
  task: AutomationTask,
  enabled: boolean,
): ReadonlyArray<string> | undefined {
  return enabled ? ALLOWLISTS[task] : undefined;
}
