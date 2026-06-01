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

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { existsSync } from 'node:fs';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { spawn, type IPty } from 'node-pty';
import { getWorkspaceById, listWorkspaces } from '@/lib/workspace';
import { getSettings } from '@/lib/settings';
import {
  createAgentWorktree,
  isGitRepo,
  pruneOrphanWorktrees,
  removeAgentWorktree,
  worktreePathFor,
} from '@/lib/agent-worktree';
import { installCortexSkill } from '@/lib/cortex-skill';
import { claudeSpawnEnv, getClaudeCliVersion, resolveClaude } from '@/lib/agents';
import { logger } from '@/lib/logger';
import { finishAgentRun, reconcileOrphanedRuns, reconcileStaleRuns } from '@/lib/issues';
import { reconcileStuckAutoMerges } from '@/lib/auto-merge';
import {
  defaultSessionStorePath,
  loadPersistedSessions,
  savePersistedSessions,
  type PersistedSession,
} from './session-store';
import { clampDim, clampInt, sanitizeName, sortSessionMetaByActivity } from './pty-util';

export const PTY_PATH = '/api/pty';
// 세션 관리 HTTP 엔드포인트 (목록·이름 변경·종료). ws 와 달리 일반 GET/POST 라
// server.ts 가 Next 핸들러보다 먼저 가로채 이 모듈의 in-memory 레지스트리에 접근한다.
export const SESSIONS_PATH = '/api/sessions';
const MAX_BODY = 10_000;
const MAX_SESSIONS = 8;
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
// scrollback replay 버퍼 상한 (문자). 재접속 시 화면 복원용 — 너무 크면 메모리 부담.
const BUFFER_CAP = 200_000;
// 구독자(ws) 없이 이 시간 지나면 pty 종료 — 버려진 세션 누수 방지.
const IDLE_REAP_MS = 10 * 60_000;

type ClientMessage =
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'kill' }
  // 위임 세션 — 연결 직후 1회. claude 의 초기 작업 지시(positional prompt)로 쓰인다.
  | { type: 'prompt'; data: string };

type Session = {
  id: string;
  // 사용자에게 보이는 이름 (세션 전환 목록용). 생성 시 클라이언트가 지정, 이후 rename 가능.
  name: string;
  workspaceId: number;
  // null 이면 dormant — 서버 재시작 후 영속 메타에서 복원된 세션(프로세스 없음). 재접속 시
  // claude --resume 로 살린다.
  proc: IPty | null;
  buffer: string;
  ws: WebSocket | null;
  reapTimer: ReturnType<typeof setTimeout> | null;
  dataSub: { dispose(): void };
  exitSub: { dispose(): void };
  createdAt: number;
  // 마지막 입출력 시각 — 목록에서 활동 여부 표시 + 가장 최근 세션 정렬용.
  lastActivityAt: number;
  // 이슈 위임으로 spawn 된 세션이면 agent_run id. 프로세스 종료 시 finishAgentRun 으로 마감.
  // (in-memory 만 — 재시작 후 복원 세션엔 없음. 그 경우 run 은 running 으로 남음, 비치명적.)
  runId: number | null;
};

// 세션 관리 엔드포인트가 클라이언트에 내보내는 메타 (proc/ws 등 내부 핸들 제외).
export type SessionMeta = {
  id: string;
  name: string;
  workspaceId: number;
  createdAt: number;
  lastActivityAt: number;
  // 현재 구독 중인 ws 가 있으면 true (어떤 탭이 보고 있음). false 면 detached(백그라운드).
  connected: boolean;
  // Phase 16 — 이 세션이 격리 worktree 에서 도는지 (워크스페이스 브랜치 보호 중). UI 가 배지로 표시.
  isolated: boolean;
};

const wss = new WebSocketServer({ noServer: true });
const sessions = new Map<string, Session>();

const NO_SUB = { dispose() {} };
const STORE_PATH = defaultSessionStorePath();

// 서버 재시작 후 복원 — 영속된 세션 메타를 dormant(프로세스 없음) 상태로 적재한다. 클라이언트가
// 재접속하면 resumeDormant 가 `claude --resume` 로 대화를 잇는다. (라이브 pty 는 부모 프로세스와
// 함께 죽었으므로 메타만 복원 가능.)
for (const meta of loadPersistedSessions(STORE_PATH).slice(0, MAX_SESSIONS)) {
  sessions.set(meta.id, {
    id: meta.id,
    name: meta.name,
    workspaceId: meta.workspaceId,
    proc: null,
    buffer: '',
    ws: null,
    reapTimer: null,
    dataSub: NO_SUB,
    exitSub: NO_SUB,
    createdAt: meta.createdAt,
    lastActivityAt: meta.lastActivityAt,
    // 복원된 run 연결 유지 — resume 후 종료 시 finishAgentRun 마감 + 시작 시 orphan 정리 제외.
    runId: meta.runId,
  });
}

// 시작 시 orphan 정리 — 이전 프로세스의 라이브 세션은 그 프로세스와 함께 죽었으므로, 복원
// 가능한(영속 메타에 남은) run 을 제외한 'running'/'queued' agent_run 은 고아다. failed 로 마감해
// 이슈가 영영 '진행 중' 으로 잔류하지 않게 한다. (서버 부팅 시 1회 — 이 모듈 로드 시점.)
{
  const restorableRunIds = [...sessions.values()]
    .map((s) => s.runId)
    .filter((x): x is number => x !== null);
  try {
    reconcileOrphanedRuns(restorableRunIds);
  } catch (err) {
    // DB 미초기화 등 — best-effort, 서버 기동을 막지 않음.
    console.error('orphan agent_run 정리 실패:', err);
  }
}

// Phase 16 — 시작 시 고아 worktree 정리. 서버 크래시 등으로 종료 시 정리 못 한 세션 worktree 가
// 잔존(디렉토리·브랜치 누적)할 수 있다. 복원된(라이브) 세션 worktree 는 보존하고 나머지는 제거.
// worktree 가 없으면(설정 OFF·미사용) listAgentWorktrees 가 빈 배열 → no-op.
{
  const liveSessionIds = new Set(sessions.keys());
  try {
    for (const ws of listWorkspaces()) {
      pruneOrphanWorktrees(ws.localPath, liveSessionIds);
    }
  } catch (err) {
    console.error('고아 worktree 정리 실패:', err);
  }
}

// Phase 13.6 — 시작 시 Cortex 스킬 자동 설치(`~/.claude/skills/cortex/SKILL.md`). 옵트인 설치
// 버튼이 있었지만 사용자가 안 누른 채 위임 시작 시 컨텍스트 부재 → 자동 보장으로 전환. 멱등
// (내용 같으면 재기록 안 함). 실패는 서버 기동을 막지 않음(best-effort).
{
  try {
    installCortexSkill();
  } catch (err) {
    console.error('Cortex 스킬 자동 설치 실패:', err);
  }
}

// Phase 13.6 — 시작 시 claude CLI 버전 로깅(회귀 가드 진단용). 미설치면 경고만, 기동은 막지 않음.
// 지원 플래그·출력 스키마 변동(readiness 신호·json-schema 등) 추적에 활용.
void getClaudeCliVersion()
  .then((v) => {
    if (v) logger.info({ source: 'pty', claudeCliVersion: v }, `claude CLI 버전: ${v}`);
    else logger.warn({ source: 'pty' }, 'claude CLI 미설치 또는 버전 조회 실패 — 위임/분석 불가');
  })
  .catch(() => {});

// Phase 13.4 — idle 타임아웃 주기 스윕. 서버가 계속 떠 있어도 오래 'running' 으로 방치된
// agent_run 을 주기적으로 마감(기본 24h 임계, 1h 마다). unref 로 프로세스 종료를 막지 않음.
// + 'auto-mergeable' 로 오래 머지 안 된(webhook 유실·크래시) PR 도 재시도(머지 가드 그대로 작동).
const STALE_RUN_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const STUCK_MERGE_MAX_AGE_MS = 60 * 60 * 1000; // 1h+ auto-mergeable = 누락된 머지로 간주.
const STALE_SWEEP_INTERVAL_MS = 60 * 60 * 1000;
{
  const sweep = () => {
    try {
      reconcileStaleRuns(STALE_RUN_MAX_AGE_MS);
    } catch (err) {
      console.error('stale agent_run 스윕 실패:', err);
    }
    // 비동기 — 응답 안 기다리고 best-effort. 머지 트리거지만 attemptAutoMerge 의 가드가 모두 작동.
    reconcileStuckAutoMerges(STUCK_MERGE_MAX_AGE_MS).catch((err) =>
      console.error('stuck auto-merge 스윕 실패:', err),
    );
  };
  sweep(); // 부팅 시 1회.
  setInterval(sweep, STALE_SWEEP_INTERVAL_MS).unref();
}

function toPersisted(s: Session): PersistedSession {
  return {
    id: s.id,
    name: s.name,
    workspaceId: s.workspaceId,
    createdAt: s.createdAt,
    lastActivityAt: s.lastActivityAt,
    runId: s.runId,
  };
}
// 현재 레지스트리 전체를 파일에 기록 (≤8개라 매 변경 시 전체 재기록해도 가볍다).
function persistAll() {
  savePersistedSessions(STORE_PATH, [...sessions.values()].map(toPersisted));
}

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
    // 라이브 세션이면 재접속, dormant(재시작 후 복원)면 claude --resume 로 되살린다.
    if (existing.proc) reattach(existing, ws);
    else resumeDormant(existing, ws, params);
    return;
  }

  // 레지스트리에 없음 — resume(새로고침 재접속) 인데 세션이 이미 끝났으면 새로 spawn 하지 않고
  // 'gone' 통지 (클라이언트가 localStorage 정리). intent=new(시작 버튼) 일 때만 새 세션 생성.
  if (params.get('intent') === 'resume') {
    send(ws, { type: 'gone', data: '' });
    ws.close();
    return;
  }
  // 위임 세션(awaitPrompt=1): 연결 직후 받는 prompt 메시지를 claude 초기 prompt 로 넘겨 spawn.
  if (params.get('awaitPrompt') === '1') {
    awaitPromptThenCreate(ws, sessionId, params);
    return;
  }
  createSession(ws, sessionId, params);
}

// awaitPrompt 세션 — 클라이언트의 {type:'prompt'} 한 건을 받아 그 내용을 claude 초기 작업
// 지시(positional prompt)로 넘겨 spawn 한다. 8초 안에 안 오면 prompt 없이 일반 세션으로 폴백.
function awaitPromptThenCreate(ws: WebSocket, sessionId: string, params: URLSearchParams) {
  let done = false;
  const finish = (initialPrompt?: string) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    ws.off('message', onMsg);
    ws.off('close', onClose);
    createSession(ws, sessionId, params, initialPrompt);
  };
  const onMsg = (raw: RawData) => {
    try {
      const msg = JSON.parse(raw.toString()) as ClientMessage;
      if (msg.type === 'prompt' && typeof msg.data === 'string') finish(msg.data);
    } catch {
      // 무시 — prompt 가 아닌 메시지(resize 등)는 spawn 전이라 버린다.
    }
  };
  const onClose = () => {
    done = true;
    clearTimeout(timer);
    ws.off('message', onMsg);
    // prompt 도착 전 ws 가 끊겨 세션이 spawn 되지 못함 — 위임 시 미리 만들어진 agent_run(runId)이
    // 영영 'running' 으로 남아 이슈가 24h(스윕)까지 '진행 중' 으로 오표시되던 것 방지(리뷰 발견).
    // 세션이 안 떴으니 failed 로 마감(사용자가 재위임 가능). best-effort.
    const runIdRaw = Number(params.get('runId'));
    if (Number.isInteger(runIdRaw) && runIdRaw > 0) {
      try {
        finishAgentRun(runIdRaw, false);
      } catch (err) {
        console.error('awaitPrompt 조기 종료 run 마감 실패:', err);
      }
    }
  };
  const timer = setTimeout(() => finish(undefined), 8000);
  ws.on('message', onMsg);
  ws.on('close', onClose);
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

// 워크스페이스/claude 검증 후 claude pty 스폰. mode='new' 면 --session-id 로 우리 UUID 를
// claude 세션 id 로 고정(→ 재시작 후 --resume 가능), mode='resume' 면 --resume 로 그 대화를
// 잇는다. 실패 시 sysClose 로 사유를 통지하고 null 반환.
function startPty(
  ws: WebSocket,
  sessionId: string,
  workspaceId: number,
  cols: number,
  rows: number,
  mode: 'new' | 'resume',
): IPty | null {
  const workspace = getWorkspaceById(workspaceId);
  if (!workspace) {
    sysClose(ws, '등록된 워크스페이스를 찾을 수 없습니다.');
    return null;
  }
  if (!existsSync(workspace.localPath)) {
    sysClose(ws, '워크스페이스 경로가 존재하지 않습니다.');
    return null;
  }
  // 명령은 클라이언트가 못 고릅니다 — 서버가 화이트리스트에서 선택.
  const claude = resolveClaude();
  if (!claude) {
    sysClose(ws, 'claude CLI 를 찾을 수 없습니다.');
    return null;
  }
  // 세션 연속성: --session-id 로 우리 UUID 를 claude 세션 id 로 고정 → 재시작 후 --resume 가능.
  const claudeArgs = mode === 'resume' ? ['--resume', sessionId] : ['--session-id', sessionId];
  // 위임 세션 초기 작업 지시는 positional prompt 가 아니라 REPL 주입으로 전달한다(sendInitialPrompt)
  // — v2.1.x 대화형에서 positional prompt 가 자동 실행되지 않고 초기 화면만 뜨는 동작 우회.
  // Windows 전역 npm bin 은 claude.cmd/.bat (배치 스크립트) — node-pty(ConPTY)가 직접
  // CreateProcess 로 실행 못 하므로 cmd.exe /c 로 감쌉니다. POSIX 는 resolve 된 경로 직접 실행.
  const isWinScript = process.platform === 'win32' && /\.(cmd|bat)$/i.test(claude.path);
  const file = isWinScript ? (process.env.ComSpec ?? 'cmd.exe') : claude.path;
  const args = isWinScript ? ['/c', claude.path, ...claudeArgs] : claudeArgs;
  // Phase 16 — worktree 격리(설정 ON 일 때만). 세션을 별도 worktree 에서 spawn 해 메인 체크아웃의
  // 브랜치를 보호. 어떤 실패든 워크스페이스 cwd 로 폴백 — OFF/비-git/실패 시 기존 동작 그대로(무회귀).
  const cwd = resolveSpawnCwd(workspace.localPath, sessionId, mode);
  try {
    return spawn(file, args, {
      name: 'xterm-256color',
      cwd,
      cols,
      rows,
      env: claudeSpawnEnv(),
    });
  } catch (err) {
    sysClose(ws, `세션을 시작하지 못했습니다: ${errMsg(err)}`);
    return null;
  }
}

// 세션 spawn cwd 결정. 설정 OFF(기본) 또는 비-git 또는 실패면 워크스페이스 localPath(=기존 동작).
// ON + git repo: 'new' 는 worktree 생성. 'resume' 는 기존 worktree 가 있으면 그대로, 없으면(prune·
// 삭제됨) **재생성**해 격리를 유지한다 — 메인 체크아웃에서 resume 하면 claude 가 dev 서버의 작업
// 트리를 건드려 worktree 격리가 깨지므로(리뷰 발견), 재생성 실패 시에만 워크스페이스 cwd 폴백.
function resolveSpawnCwd(
  workspaceLocalPath: string,
  sessionId: string,
  mode: 'new' | 'resume',
): string {
  try {
    if (!getSettings().agentWorktreeEnabled) return workspaceLocalPath;
    if (!isGitRepo(workspaceLocalPath)) return workspaceLocalPath;
    if (mode === 'new') {
      return createAgentWorktree(workspaceLocalPath, sessionId) ?? workspaceLocalPath;
    }
    const wt = worktreePathFor(workspaceLocalPath, sessionId);
    if (existsSync(wt)) return wt;
    // resume 인데 worktree 가 사라짐 — 격리 유지를 위해 재생성(실패 시 워크스페이스 cwd 폴백).
    return createAgentWorktree(workspaceLocalPath, sessionId) ?? workspaceLocalPath;
  } catch (err) {
    console.error('worktree cwd 해석 실패 — 워크스페이스 cwd 폴백:', err);
    return workspaceLocalPath;
  }
}

// pty 의 출력/종료를 세션 버퍼·ws 에 연결하고 클라이언트 메시지 핸들러를 건다 (신규·재개 공통).
function wireProc(session: Session) {
  const proc = session.proc;
  if (!proc) return;
  session.dataSub = proc.onData((d) => {
    session.buffer = (session.buffer + d).slice(-BUFFER_CAP);
    session.lastActivityAt = Date.now();
    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(JSON.stringify({ type: 'output', data: d }));
    }
    // 위임 세션 초기 prompt 가 대기 중이면 출력에서 REPL 준비 신호를 검사 → 발견 시 주입 예약.
    const injector = promptInjectors.get(session.id);
    if (injector) injector(session.buffer);
  });
  session.exitSub = proc.onExit(({ exitCode }) => {
    if (session.ws) send(session.ws, { type: 'exit', data: String(exitCode) });
    destroy(session, exitCode === 0);
  });
  if (session.ws) wireClient(session, session.ws);
}

function createSession(
  ws: WebSocket,
  sessionId: string,
  params: URLSearchParams,
  initialPrompt?: string,
) {
  if (sessions.size >= MAX_SESSIONS) {
    sysClose(ws, '동시 실행 세션 한도를 초과했습니다.');
    return;
  }
  const workspaceId = Number(params.get('workspaceId'));
  if (!Number.isInteger(workspaceId) || workspaceId <= 0) {
    sysClose(ws, '워크스페이스 ID 가 올바르지 않습니다.');
    return;
  }
  const cols = clampDim(params.get('cols'), DEFAULT_COLS);
  const rows = clampDim(params.get('rows'), DEFAULT_ROWS);
  const name = sanitizeName(params.get('name')) || `세션 ${sessions.size + 1}`;
  // 이슈 위임 세션이면 agent_run id 동봉 — 종료 시 그 run 을 마감한다.
  const runIdRaw = Number(params.get('runId'));
  const runId = Number.isInteger(runIdRaw) && runIdRaw > 0 ? runIdRaw : null;

  const proc = startPty(ws, sessionId, workspaceId, cols, rows, 'new');
  if (!proc) return;

  const now = Date.now();
  const session: Session = {
    id: sessionId,
    name,
    workspaceId,
    proc,
    buffer: '',
    ws,
    reapTimer: null,
    dataSub: NO_SUB,
    exitSub: NO_SUB,
    createdAt: now,
    lastActivityAt: now,
    runId,
  };
  sessions.set(sessionId, session);
  wireProc(session);
  // 위임 세션: REPL 이 뜬 뒤 초기 작업 지시를 입력으로 주입(아래 sendInitialPrompt).
  if (initialPrompt) sendInitialPrompt(session, initialPrompt);
  persistAll();
}

// 위임 세션 초기 작업 지시 — claude 대화형 REPL 에 bracketed paste(ESC[200~ … ESC[201~)로
// prompt 를 한 번에 입력하고 CR 로 제출한다(여러 줄도 줄마다 제출되지 않음). positional 초기
// prompt 가 v2.1.x 대화형에서 자동 실행되지 않는 동작을 우회.
//
// 신뢰성 — 예전엔 1500ms 고정 지연 후 1회 주입이라 claude 초기 출력(광고 배너·hint)이 그 안에
// 안 끝나면 paste 가 묻혀 사라졌다(간헐적 "복사 안 됨" 보고). 이제 출력 버퍼에서 REPL 준비
// 신호(`? for shortcuts` 등)를 감지해 그 시점에 주입 + 신호 못 보면 8s fallback. idempotent
// (한 번만 발화 — 신호 감지/타이머/destroy 어느 쪽에서도 안전).
const PROMPT_READY_RE = /\? for shortcuts|for agents/i;
const PROMPT_READY_STABILIZE_MS = 400;
const PROMPT_FALLBACK_DELAY_MS = 8000;

// 세션 id → 출력 검사 콜백. wireProc 의 onData 가 각 청크마다 호출 → 신호 감지 시 paste 예약.
// destroy 가 정리 → 누수 0.
const promptInjectors = new Map<string, (buffer: string) => void>();

function sendInitialPrompt(session: Session, prompt: string) {
  let armed = true;
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  let stabilizeTimer: ReturnType<typeof setTimeout> | null = null;

  const doPaste = () => {
    if (!armed) return;
    armed = false;
    promptInjectors.delete(session.id);
    if (fallbackTimer) clearTimeout(fallbackTimer);
    if (stabilizeTimer) clearTimeout(stabilizeTimer);
    // destroy 이후 fallback 타이머가 늦게 발화하면 sessions 에 없음 → no-op.
    if (!sessions.has(session.id)) return;
    try {
      if (session.proc) session.proc.write(`\x1b[200~${prompt}\x1b[201~\r`);
    } catch {
      // proc 이 이미 종료됐을 수 있음 — best-effort.
    }
  };

  // 신호 감지 — paste 직전 살짝 안정화(렌더 안정) 후 발화.
  promptInjectors.set(session.id, (buf) => {
    if (!armed || stabilizeTimer) return;
    if (PROMPT_READY_RE.test(buf)) {
      stabilizeTimer = setTimeout(doPaste, PROMPT_READY_STABILIZE_MS);
    }
  });

  // 신호 못 봐도 fallback — 무한 대기 방지. 옛 1500ms 보다 넉넉.
  fallbackTimer = setTimeout(doPaste, PROMPT_FALLBACK_DELAY_MS);
}

// 재시작 후 dormant(프로세스 없는) 세션에 재접속 — claude --resume 로 대화 재개. 실패 시
// (워크스페이스 삭제·claude 없음·resume 불가) 해당 dormant 세션을 레지스트리에서 정리한다.
function resumeDormant(session: Session, ws: WebSocket, params: URLSearchParams) {
  const cols = clampDim(params.get('cols'), DEFAULT_COLS);
  const rows = clampDim(params.get('rows'), DEFAULT_ROWS);
  const proc = startPty(ws, session.id, session.workspaceId, cols, rows, 'resume');
  if (!proc) {
    sessions.delete(session.id);
    persistAll();
    return;
  }
  if (session.reapTimer) {
    clearTimeout(session.reapTimer);
    session.reapTimer = null;
  }
  session.proc = proc;
  session.ws = ws;
  session.buffer = '';
  session.lastActivityAt = Date.now();
  wireProc(session);
  persistAll();
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
      session.lastActivityAt = Date.now();
      session.proc?.write(msg.data);
    } else if (msg.type === 'resize') {
      session.proc?.resize(clampInt(msg.cols, DEFAULT_COLS), clampInt(msg.rows, DEFAULT_ROWS));
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
  persistAll(); // lastActivityAt 등 최신 메타를 디스크에 반영 (재시작 복원용).
}

// 세션 완전 종료 — pty kill + 레지스트리 제거 + 구독 해제 + (위임 세션이면) agent_run 마감.
// ok: 정상 종료(exit 0)·사용자/idle 종료면 true(completed), 비정상 exit 면 false(failed).
function destroy(session: Session, ok = true) {
  // 멱등 가드 — 중복 호출(프로세스 onExit + 사용자 terminate/× 가 거의 동시에) 시 두 번째는 즉시
  // 반환. destroy 는 동기라 중복 호출은 back-to-back 이고, 첫 호출이 sessions.delete 하므로 두 번째는
  // 여기서 걸린다. run 이중 마감·worktree 이중 정리(갓 죽은 proc 의 cwd 를 두 번 건드리는 Windows
  // file-lock 위험)·알림 중복을 막는다(리뷰 발견).
  if (!sessions.has(session.id)) return;
  if (session.reapTimer) {
    clearTimeout(session.reapTimer);
    session.reapTimer = null;
  }
  session.dataSub.dispose();
  session.exitSub.dispose();
  try {
    session.proc?.kill();
  } catch {
    // 이미 종료됐거나 dormant(proc 없음) — 무시.
  }
  // 모든 종료 경로(× kill · idle reap · 프로세스 exit)에서 agent_run 을 마감한다. 예전엔 onExit
  // 에서만 마감돼, 사용자가 세션을 안 닫거나 ×·reap 으로 끝나면 run 이 영영 running 으로 남아
  // 이슈가 완료 안 되고 대시보드 '에이전트 진행 중' 카운트가 잔류했다. runId 를 비워 중복 마감 방지.
  if (session.runId != null) {
    finishAgentRun(session.runId, ok);
    session.runId = null;
  }
  // Phase 16 — 세션 worktree 정리(있을 때만 — 없으면 no-op 라 OFF 모드 무해). 잔존 브랜치/디렉토리
  // 누적 방지. best-effort — 정리 실패가 세션 종료를 막지 않게.
  try {
    const ws = getWorkspaceById(session.workspaceId);
    if (ws) removeAgentWorktree(ws.localPath, session.id);
  } catch (err) {
    console.error(`worktree 정리 실패 (세션 ${session.id}):`, err);
  }
  // 위임 prompt 가 아직 못 들어간 채 세션이 끝나면 injector 도 정리(타이머가 dangling 안 되게).
  promptInjectors.delete(session.id);
  if (session.ws && session.ws.readyState === WebSocket.OPEN) session.ws.close();
  sessions.delete(session.id);
  persistAll();
}

// 세션 관리 HTTP 핸들러 — server.ts 가 Next 핸들러보다 먼저 호출. 우리 경로면 처리하고
// true, 아니면 false (호출측이 Next 로 위임). ws(/api/pty)와 같은 모듈이라 in-memory
// 레지스트리를 공유한다 (App Router route handler 는 별도 모듈 그래프라 이 map 을 못 봄).
// localhost 단일 사용자 — 인증 없음. 입력은 길이/타입 검증만.
export function handlePtyControl(req: IncomingMessage, res: ServerResponse): boolean {
  const url = new URL(req.url ?? '', 'http://localhost');
  if (url.pathname !== SESSIONS_PATH) return false;

  if (req.method === 'GET') {
    sendJson(res, 200, { sessions: listSessionMeta() });
    return true;
  }
  if (req.method === 'POST') {
    readJsonBody(req, res, (body) => handleControlAction(res, body));
    return true;
  }
  sendJson(res, 405, { error: 'method not allowed' });
  return true;
}

// 최근 활동 순 — 활성 세션이 위로.
function listSessionMeta(): SessionMeta[] {
  // 격리 여부는 설정 ON 일 때만 worktree 존재로 판별 (세션당 가벼운 FS 체크). OFF 면 전부 false.
  const worktreeOn = (() => {
    try {
      return getSettings().agentWorktreeEnabled;
    } catch {
      return false;
    }
  })();
  return sortSessionMetaByActivity(
    [...sessions.values()].map((s) => {
      let isolated = false;
      if (worktreeOn) {
        const ws = getWorkspaceById(s.workspaceId);
        if (ws) isolated = existsSync(worktreePathFor(ws.localPath, s.id));
      }
      return {
        id: s.id,
        name: s.name,
        workspaceId: s.workspaceId,
        createdAt: s.createdAt,
        lastActivityAt: s.lastActivityAt,
        connected: s.ws !== null && s.ws.readyState === WebSocket.OPEN,
        isolated,
      };
    }),
  );
}

function handleControlAction(
  res: ServerResponse,
  body: { action?: unknown; id?: unknown; name?: unknown },
) {
  const id = typeof body.id === 'string' ? body.id : null;
  if (!id) {
    sendJson(res, 400, { error: 'id required' });
    return;
  }
  const session = sessions.get(id);
  if (!session) {
    sendJson(res, 404, { error: 'session not found' });
    return;
  }
  if (body.action === 'rename') {
    const name = sanitizeName(typeof body.name === 'string' ? body.name : null);
    if (!name) {
      sendJson(res, 400, { error: 'name required' });
      return;
    }
    session.name = name;
    persistAll();
    sendJson(res, 200, { ok: true });
    return;
  }
  if (body.action === 'terminate') {
    destroy(session);
    sendJson(res, 200, { ok: true });
    return;
  }
  sendJson(res, 400, { error: 'unknown action' });
}

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readJsonBody(
  req: IncomingMessage,
  res: ServerResponse,
  onParsed: (body: { action?: unknown; id?: unknown; name?: unknown }) => void,
) {
  let data = '';
  let aborted = false;
  req.on('data', (chunk) => {
    data += chunk;
    if (data.length > MAX_BODY) {
      aborted = true;
      sendJson(res, 413, { error: 'body too large' });
      req.destroy();
    }
  });
  req.on('end', () => {
    if (aborted) return;
    try {
      onParsed(JSON.parse(data || '{}'));
    } catch {
      sendJson(res, 400, { error: 'invalid json' });
    }
  });
  req.on('error', () => {
    if (!aborted) sendJson(res, 400, { error: 'request error' });
  });
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
