// Phase 13 — Claude CLI 터미널 임베드의 서버측 PTY 매니저 (detached 세션).
// 커스텀 서버(server.ts)에서만 로드됩니다 — App Router route handler 는 WebSocket
// upgrade 를 못 하므로 별도 ws 서버로 처리하고, node-pty 로 claude CLI 를 등록된
// 워크스페이스 cwd 에서 spawn 합니다.
//
// 새로고침 유지(2단계): pty 를 sessionId 로 보관하고 ws close 시 죽이지 않는다. 클라이언트가
// 같은 sessionId 로 재접속하면 scrollback 버퍼를 replay 후 라이브 스트림 재개. 구독자(ws)
// 없이 IDLE_REAP_MS 지나면 종료(유실 방지). 명시적 'kill' 또는 프로세스 exit 시 즉시 정리.
//
// 보안 (박제):
// - spawn 명령은 화이트리스트(resolveClaude)만. 클라이언트는 명령을 못 고릅니다.
// - cwd 는 DB 에 등록된 워크스페이스 localPath 만 (getWorkspaceById 조회가 곧 화이트리스트).
// - 동시 세션 수 상한. cwd 미존재 시 거부. localhost 단일 사용자라 sessionId(UUID)면 충분.

import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { existsSync } from 'node:fs';
import { WebSocketServer, WebSocket } from 'ws';
import { spawn, type IPty } from 'node-pty';
import { getWorkspaceById } from '@/lib/workspace';
import { claudeSpawnEnv, resolveClaude } from '@/lib/agents';

export const PTY_PATH = '/api/pty';
const MAX_SESSIONS = 8;
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const MAX_DIM = 500;
// scrollback replay 버퍼 상한 (문자). 재접속 시 화면 복원용 — 너무 크면 메모리 부담.
const BUFFER_CAP = 200_000;
// 구독자(ws) 없이 이 시간 지나면 pty 종료 — 버려진 세션 누수 방지.
const IDLE_REAP_MS = 10 * 60_000;

type ClientMessage =
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'kill' };

type Session = {
  id: string;
  workspaceId: number;
  proc: IPty;
  buffer: string;
  ws: WebSocket | null;
  reapTimer: ReturnType<typeof setTimeout> | null;
  dataSub: { dispose(): void };
  exitSub: { dispose(): void };
};

const wss = new WebSocketServer({ noServer: true });
const sessions = new Map<string, Session>();

function send(ws: WebSocket, payload: { type: string; data: string }) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}
function sysClose(ws: WebSocket, message: string) {
  send(ws, { type: 'system', data: message });
  ws.close();
}

// 커스텀 서버의 'upgrade' 이벤트에서 호출. 우리 경로면 처리하고 true, 아니면 false 를
// 반환 → 호출측이 Next upgrade 핸들러(HMR 등)로 위임합니다.
export function handlePtyUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
  const url = new URL(req.url ?? '', 'http://localhost');
  if (url.pathname !== PTY_PATH) return false;
  wss.handleUpgrade(req, socket, head, (ws) => onConnect(ws, url.searchParams));
  return true;
}

function onConnect(ws: WebSocket, params: URLSearchParams) {
  const sessionId = params.get('sessionId');
  if (!sessionId) {
    sysClose(ws, '세션 ID 가 없습니다.');
    return;
  }

  const existing = sessions.get(sessionId);
  if (existing) {
    reattach(existing, ws);
    return;
  }

  // 레지스트리에 없음 — resume(새로고침 재접속) 인데 세션이 이미 끝났으면 새로 spawn 하지 않고
  // 'gone' 통지 (클라이언트가 localStorage 정리). intent=new(시작 버튼) 일 때만 새 세션 생성.
  if (params.get('intent') === 'resume') {
    send(ws, { type: 'gone', data: '' });
    ws.close();
    return;
  }
  createSession(ws, sessionId, params);
}

function reattach(session: Session, ws: WebSocket) {
  // 단일 구독자 — 이전 ws 가 살아 있으면 닫는다 (다중 탭은 마지막 접속만).
  if (session.ws && session.ws !== ws && session.ws.readyState === WebSocket.OPEN) {
    session.ws.close();
  }
  session.ws = ws;
  if (session.reapTimer) {
    clearTimeout(session.reapTimer);
    session.reapTimer = null;
  }
  // scrollback replay → 새로고침 후 화면 복원.
  if (session.buffer) send(ws, { type: 'output', data: session.buffer });
  wireClient(session, ws);
}

function createSession(ws: WebSocket, sessionId: string, params: URLSearchParams) {
  if (sessions.size >= MAX_SESSIONS) {
    sysClose(ws, '동시 실행 세션 한도를 초과했습니다.');
    return;
  }

  const workspaceId = Number(params.get('workspaceId'));
  if (!Number.isInteger(workspaceId) || workspaceId <= 0) {
    sysClose(ws, '워크스페이스 ID 가 올바르지 않습니다.');
    return;
  }

  const workspace = getWorkspaceById(workspaceId);
  if (!workspace) {
    sysClose(ws, '등록된 워크스페이스를 찾을 수 없습니다.');
    return;
  }
  if (!existsSync(workspace.localPath)) {
    sysClose(ws, '워크스페이스 경로가 존재하지 않습니다.');
    return;
  }

  // 명령은 클라이언트가 못 고릅니다 — 서버가 화이트리스트에서 선택.
  const claude = resolveClaude();
  if (!claude) {
    sysClose(ws, 'claude CLI 를 찾을 수 없습니다.');
    return;
  }

  const cols = clampDim(params.get('cols'), DEFAULT_COLS);
  const rows = clampDim(params.get('rows'), DEFAULT_ROWS);

  // Windows 전역 npm bin 은 claude.cmd/.bat (배치 스크립트) — node-pty(ConPTY)가 직접
  // CreateProcess 로 실행 못 하므로 cmd.exe /c 로 감쌉니다. POSIX 는 resolve 된 경로 직접 실행.
  const isWinScript = process.platform === 'win32' && /\.(cmd|bat)$/i.test(claude.path);
  const file = isWinScript ? (process.env.ComSpec ?? 'cmd.exe') : claude.path;
  const args = isWinScript ? ['/c', claude.path] : [];

  let proc: IPty;
  try {
    proc = spawn(file, args, {
      name: 'xterm-256color',
      cwd: workspace.localPath,
      cols,
      rows,
      env: claudeSpawnEnv(),
    });
  } catch (err) {
    sysClose(ws, `세션을 시작하지 못했습니다: ${errMsg(err)}`);
    return;
  }

  const session: Session = {
    id: sessionId,
    workspaceId,
    proc,
    buffer: '',
    ws,
    reapTimer: null,
    dataSub: { dispose() {} },
    exitSub: { dispose() {} },
  };

  session.dataSub = proc.onData((d) => {
    session.buffer = (session.buffer + d).slice(-BUFFER_CAP);
    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(JSON.stringify({ type: 'output', data: d }));
    }
  });
  session.exitSub = proc.onExit(({ exitCode }) => {
    if (session.ws) send(session.ws, { type: 'exit', data: String(exitCode) });
    destroy(session);
  });

  sessions.set(sessionId, session);
  wireClient(session, ws);
}

// ws 한 개에 메시지/종료 핸들러를 건다. 재접속마다 새 ws 객체라 리스너 누수 없음.
function wireClient(session: Session, ws: WebSocket) {
  ws.on('message', (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString()) as ClientMessage;
    } catch {
      return;
    }
    if (msg.type === 'input' && typeof msg.data === 'string') {
      session.proc.write(msg.data);
    } else if (msg.type === 'resize') {
      session.proc.resize(clampInt(msg.cols, DEFAULT_COLS), clampInt(msg.rows, DEFAULT_ROWS));
    } else if (msg.type === 'kill') {
      destroy(session);
    }
  });
  ws.on('close', () => detach(session, ws));
  ws.on('error', () => detach(session, ws));
}

// ws 끊김 — pty 는 살려두고(새로고침 재접속 대비) idle reap 타이머만 건다.
function detach(session: Session, ws: WebSocket) {
  if (session.ws !== ws) return; // 이미 다른 ws 로 reattach 됨 — 무시.
  session.ws = null;
  if (session.reapTimer) clearTimeout(session.reapTimer);
  session.reapTimer = setTimeout(() => destroy(session), IDLE_REAP_MS);
}

// 세션 완전 종료 — pty kill + 레지스트리 제거 + 구독 해제.
function destroy(session: Session) {
  if (session.reapTimer) {
    clearTimeout(session.reapTimer);
    session.reapTimer = null;
  }
  session.dataSub.dispose();
  session.exitSub.dispose();
  try {
    session.proc.kill();
  } catch {
    // 이미 종료됨 — 무시.
  }
  if (session.ws && session.ws.readyState === WebSocket.OPEN) session.ws.close();
  sessions.delete(session.id);
}

function clampDim(raw: string | null, fallback: number): number {
  return clampInt(raw === null ? Number.NaN : Number(raw), fallback);
}
function clampInt(n: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_DIM, Math.max(1, Math.floor(n)));
}
function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
