// Phase 13 — Claude CLI 터미널 임베드의 서버측 PTY 매니저.
// 커스텀 서버(server.ts)에서만 로드됩니다 — App Router route handler 는 WebSocket
// upgrade 를 못 하므로 별도 ws 서버로 처리하고, node-pty 로 claude CLI 를 등록된
// 워크스페이스 cwd 에서 spawn 합니다.
//
// 보안 (박제):
// - spawn 명령은 화이트리스트(findClaudeCommand)만. 클라이언트는 명령을 못 고릅니다.
// - cwd 는 DB 에 등록된 워크스페이스 localPath 만 (getWorkspaceById 조회가 곧 화이트리스트).
// - 동시 세션 수 상한. cwd 미존재 시 거부.

import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { existsSync } from 'node:fs';
import { WebSocketServer, WebSocket } from 'ws';
import { spawn, type IPty } from 'node-pty';
import { getWorkspaceById } from '@/lib/workspace';
import { findClaudeCommand } from '@/lib/agents';

export const PTY_PATH = '/api/pty';
const MAX_SESSIONS = 8;
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const MAX_DIM = 500;

type ClientMessage =
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number };

const wss = new WebSocketServer({ noServer: true });
const sessions = new Set<IPty>();

function sysClose(ws: WebSocket, message: string) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'system', data: message }));
  }
  ws.close();
}

// 커스텀 서버의 'upgrade' 이벤트에서 호출. 우리 경로면 처리하고 true, 아니면 false 를
// 반환 → 호출측이 Next upgrade 핸들러(HMR 등)로 위임합니다.
export function handlePtyUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
  const url = new URL(req.url ?? '', 'http://localhost');
  if (url.pathname !== PTY_PATH) return false;
  wss.handleUpgrade(req, socket, head, (ws) => startSession(ws, url.searchParams));
  return true;
}

function startSession(ws: WebSocket, params: URLSearchParams) {
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
  const command = findClaudeCommand();
  if (!command) {
    sysClose(ws, 'claude CLI 를 찾을 수 없습니다.');
    return;
  }

  const cols = clampDim(params.get('cols'), DEFAULT_COLS);
  const rows = clampDim(params.get('rows'), DEFAULT_ROWS);

  let proc: IPty;
  try {
    proc = spawn(command, [], {
      name: 'xterm-256color',
      cwd: workspace.localPath,
      cols,
      rows,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
  } catch (err) {
    sysClose(ws, `세션을 시작하지 못했습니다: ${errMsg(err)}`);
    return;
  }

  sessions.add(proc);

  const dataSub = proc.onData((d) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'output', data: d }));
  });
  const exitSub = proc.onExit(({ exitCode }) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'exit', data: String(exitCode) }));
    }
    ws.close();
  });

  ws.on('message', (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString()) as ClientMessage;
    } catch {
      return;
    }
    if (msg.type === 'input' && typeof msg.data === 'string') {
      proc.write(msg.data);
    } else if (msg.type === 'resize') {
      proc.resize(clampInt(msg.cols, DEFAULT_COLS), clampInt(msg.rows, DEFAULT_ROWS));
    }
  });

  const cleanup = () => {
    dataSub.dispose();
    exitSub.dispose();
    sessions.delete(proc);
    try {
      proc.kill();
    } catch {
      // 이미 종료됨 — 무시.
    }
  };
  ws.on('close', cleanup);
  ws.on('error', cleanup);
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
