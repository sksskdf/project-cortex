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
  | { type: 'sync'; prId?: number; kind?: 'inserted' | 'updated' }
  | { type: 'connected' };

// Phase 10.2 후속 — 새 알림 발생 시 브라우저 Notification 표시용 payload.
// notifications 테이블에 row insert 시점에 함께 emit.
export type NotificationEvent = {
  type: 'notification';
  kind: string; // NotificationKind
  title: string;
  body: string | null;
  href: string | null;
};

// SSE route 에 추가로 listen 할 이벤트.
export const NOTIFICATION_EVENT = 'notification' as const;

// broadcast wrapper — 기존 'sync' 흐름 호환. notification 은 별도 채널.
export function broadcastSync(payload?: Partial<CortexEvent>): void {
  events.emit('sync', { type: 'sync', ...payload });
}

export function broadcastNotification(payload: Omit<NotificationEvent, 'type'>): void {
  events.emit(NOTIFICATION_EVENT, { type: 'notification', ...payload });
}

// 기존 호출자 호환 — `events.broadcast({type: 'sync'})` 패턴.
// declare module 대신 별도 export 로 wrapper 제공.
export function broadcast(event: CortexEvent | NotificationEvent): void {
  if (event.type === 'notification') {
    events.emit(NOTIFICATION_EVENT, event);
  } else {
    events.emit('sync', event);
  }
}
