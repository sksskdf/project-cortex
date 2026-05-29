// 진행 중 자동화 추적 — conflict-resolve / test-fix / review-fix 가 claude 작업을 도는 동안
// 그 사실을 UI(인박스 행·PR 상세)에 라이브로 보여주기 위한 인메모리 레지스트리.
//
// 왜 DB 컬럼이 아니라 인메모리인가:
// - 단일 서버 프로세스 가정(events.ts·node-pty 와 동일). RSC 렌더도 같은 프로세스라 읽힘.
// - 프로세스 재시작 시 자연 소멸 → 죽은 작업이 'in-flight' 로 영구 박제되는 stuck 상태 없음
//   (agent_run 영구 running 문제의 재발 방지). DB 영속/마이그레이션 불필요.
// - set/clear 시 broadcastSync() 로 SSE refresh → 칩이 즉시 뜨고/사라짐.

import { broadcastSync } from './events';

export type AutomationKind = 'resolving-conflict' | 'fixing-tests' | 'addressing-review';

declare global {
  // HMR 이 모듈을 재평가해도 Map 을 유지 (events.ts 패턴).
  // eslint-disable-next-line no-var
  var __cortexAutomationInFlight: Map<number, AutomationKind> | undefined;
}

const inFlight = globalThis.__cortexAutomationInFlight ?? new Map<number, AutomationKind>();
if (!globalThis.__cortexAutomationInFlight) {
  globalThis.__cortexAutomationInFlight = inFlight;
}

// 자동화 시작 — claude 작업 직전에 호출. 같은 PR 의 in-flight 갱신.
export function setAutomationInFlight(prId: number, kind: AutomationKind): void {
  inFlight.set(prId, kind);
  safeBroadcast();
}

// 자동화 종료(성공/실패/중단) — 터미널 경로에서 호출. 멱등 — 안 set 된 prId 면 no-op.
export function clearAutomationInFlight(prId: number): void {
  if (inFlight.delete(prId)) safeBroadcast();
}

// 현재 진행 중 kind (없으면 null). 인박스/대시보드/PR 상세 렌더가 읽음.
export function getAutomationInFlight(prId: number): AutomationKind | null {
  return inFlight.get(prId) ?? null;
}

function safeBroadcast(): void {
  try {
    broadcastSync();
  } catch {
    // broadcast 실패가 자동화 흐름을 막지 않게 — best-effort.
  }
}
