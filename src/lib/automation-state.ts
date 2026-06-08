// 진행 중 자동화 추적 — conflict-resolve / test-fix / review-fix 가 claude 작업을 도는 동안
// 그 사실을 UI(인박스 행·PR 상세)에 라이브로 보여주기 위함.
//
// 영속화 이유(검수 P1-3): 이전엔 in-process Map 이라 (a) HMR/재시작 시 칩이 사라져 사용자가
// "안 돌고 있나" 오해, (b) 시도 카운터의 휘발성과 비대칭. 이제 prs.automationInFlight 컬럼에
// 영속화 — 같은 API(set/clear/get/count) 유지.
//
// 안전망(부팅 청소): 죽은 프로세스의 작업이 영구 in-flight 박제되는 사고(agent_runs running
// 영구 박제와 동일)를 막기 위해 부팅 시 한 번 reconcileStaleAutomationInFlight() 가 모두 NULL
// 로 청소한다. UI 가 다시 자연스럽게 새로 set 된 작업만 표시. server.ts/pty 부팅 시 호출.

import { eq, isNotNull, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { prs } from '@/db/schema';
import { broadcastSync } from './events';

export type AutomationKind = 'resolving-conflict' | 'fixing-tests' | 'addressing-review';

// 자동화 시작 — claude 작업 직전에 호출. 같은 PR 의 in-flight 갱신.
export function setAutomationInFlight(prId: number, kind: AutomationKind): void {
  db.update(prs).set({ automationInFlight: kind }).where(eq(prs.id, prId)).run();
  safeBroadcast();
}

// 자동화 종료(성공/실패/중단) — 터미널 경로에서 호출. 멱등.
export function clearAutomationInFlight(prId: number): void {
  db.update(prs).set({ automationInFlight: null }).where(eq(prs.id, prId)).run();
  safeBroadcast();
}

// 현재 진행 중 kind (없으면 null). 인박스/대시보드/PR 상세 렌더가 읽음.
export function getAutomationInFlight(prId: number): AutomationKind | null {
  const row = db.select({ kind: prs.automationInFlight }).from(prs).where(eq(prs.id, prId)).get();
  return (row?.kind as AutomationKind | null | undefined) ?? null;
}

// 진행 중 자동화 총 개수 — G1 라이브 상태 스트립용.
export function countAutomationInFlight(): number {
  const row = db
    .select({ n: sql<number>`count(*)` })
    .from(prs)
    .where(isNotNull(prs.automationInFlight))
    .get();
  return row?.n ?? 0;
}

// 부팅 시 한 번 호출 — 모든 in-flight 마커 청소. 죽은 프로세스 작업 박제 방지.
// 반환: 청소한 행 수(로깅용).
export function reconcileStaleAutomationInFlight(): number {
  const rows = db
    .update(prs)
    .set({ automationInFlight: null })
    .where(isNotNull(prs.automationInFlight))
    .run();
  return rows.changes ?? 0;
}

function safeBroadcast(): void {
  try {
    broadcastSync();
  } catch {
    // broadcast 실패가 자동화 흐름을 막지 않게 — best-effort.
  }
}
