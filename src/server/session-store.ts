// Phase 16 — 에이전트 세션 메타 영속화 (재시작 후 연속성).
// pty.ts 의 세션 레지스트리는 in-memory 라 서버 재시작 시 소실된다. 여기서 세션 메타를
// JSON 파일에 저장해 두고, 재시작 후 dormant(프로세스 없는) 세션으로 복원한다. 클라이언트가
// dormant 세션에 재접속하면 pty.ts 가 `claude --resume <id>` 로 대화를 잇는다 — 세션 생성 시
// `claude --session-id <id>` 로 우리 UUID 를 claude 세션 id 로 고정해 두기 때문에 가능하다.
//
// proc/ws/buffer 같은 런타임 핸들은 저장하지 않는다(복원 불가). 영속 실패가 런타임을 막지
// 않도록 read/write 모두 예외를 삼키고 best-effort 로 동작한다.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type PersistedSession = {
  id: string;
  name: string;
  workspaceId: number;
  createdAt: number;
  lastActivityAt: number;
};

// 세션 파일 경로 — DB 와 같은 data 디렉토리(둘 다 CORTEX_DB_PATH 기준).
export function defaultSessionStorePath(): string {
  const dbPath = process.env.CORTEX_DB_PATH ?? 'data/cortex.sqlite';
  return join(dirname(dbPath), 'agent-sessions.json');
}

// 파일에서 세션 메타 로드. 없거나 손상됐으면 빈 배열(첫 실행/복구 안전).
export function loadPersistedSessions(path: string): PersistedSession[] {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return []; // 파일 없음.
  }
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter(isPersistedSession);
  } catch {
    return []; // 손상 — 무시.
  }
}

// 원자적 쓰기(tmp → rename) — 쓰기 중 크래시로 파일이 반쯤 써지는 걸 방지.
export function savePersistedSessions(path: string, list: PersistedSession[]): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf8');
    renameSync(tmp, path);
  } catch {
    // 영속 실패는 무시 — 다음 변경 때 다시 시도, 런타임은 계속.
  }
}

function isPersistedSession(v: unknown): v is PersistedSession {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    o.id.length > 0 &&
    typeof o.name === 'string' &&
    typeof o.workspaceId === 'number' &&
    typeof o.createdAt === 'number' &&
    typeof o.lastActivityAt === 'number'
  );
}
