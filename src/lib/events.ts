// in-process EventEmitter — webhook 핸들러가 sync 성공 후 emit, SSE 라우트가 listen.
// 단일 노드 dev 환경 가정. 여러 인스턴스로 확장 시 Redis pub/sub 등으로 교체.

import { EventEmitter } from 'node:events';

declare global {
  // Next.js dev HMR 이 모듈을 다시 평가해도 EventEmitter 인스턴스를 유지해야
  // 기존 SSE 리스너가 끊기지 않음. globalThis 에 한 개만 보관.
  // eslint-disable-next-line no-var
  var __cortexEvents: EventEmitter | undefined;
}

export const events = globalThis.__cortexEvents ?? new EventEmitter();

if (!globalThis.__cortexEvents) {
  // SSE 클라이언트가 여럿이면 리스너도 늘어남 — 디폴트 10 으로 cap 되면 경고 발생.
  events.setMaxListeners(100);
  globalThis.__cortexEvents = events;
}

export type CortexEvent =
  | { type: 'sync'; prId: number; kind: 'inserted' | 'updated' }
  | { type: 'connected' };
