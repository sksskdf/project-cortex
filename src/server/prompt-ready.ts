// 위임 세션 초기 prompt 주입의 "REPL 준비" 신호 감지 — pty.ts 에서 분리해 단위 테스트 가능하게.
// (pty.ts 는 모듈 로드 시 서버 부작용이 있어 직접 import-테스트가 어렵다.)
//
// claude 대화형 REPL 이 입력을 받을 준비가 됐을 때 출력하는 힌트 문구를 감지한다. 이 신호를
// 보면 그 시점에 bracketed-paste 로 prompt 를 주입한다. 신호를 못 보면 fallback 타이머로 주입.
const PROMPT_READY_RE = /\? for shortcuts|for agents/i;

// 출력 버퍼에 REPL 준비 신호가 있으면 true. 순수 함수 — 테스트 가능.
export function isPromptReady(buffer: string): boolean {
  return PROMPT_READY_RE.test(buffer);
}
