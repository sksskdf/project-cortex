'use client';

// Phase 13 — 에이전트 터미널 콘솔. 워크스페이스 선택 → claude CLI 세션 spawn → xterm.js 로
// PTY 스트림 입출력. WebSocket(/api/pty)으로 커스텀 서버의 node-pty 와 연결됩니다.
//
// 다중 세션 관리: 서버 detached 세션이 source of truth. /api/sessions (GET) 로 목록을
// 받아 전환·이름 변경·종료한다. 터미널 패널엔 한 번에 active 세션 하나만 표시하고, 다른
// 세션 클릭 시 intent=resume 으로 재접속(서버가 scrollback replay). 새 세션은 intent=new.
//
// 새로고침 유지: active 세션 id 를 localStorage 에 저장 → 마운트 시 목록에 살아 있으면 복원.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Terminal } from '@xterm/xterm';
import { ko as t } from '@/copy/ko';
import '@xterm/xterm/css/xterm.css';
import styles from './AgentConsole.module.css';

export type WorkspaceOption = {
  id: number;
  projectSlug: string;
  localPath: string;
};

type Status = 'connecting' | 'open' | 'closed' | 'error';
// 터미널 패널에 표시 중인 세션. 새로 만들면 intent='new', 기존 전환/복원은 'resume'.
// runId: 이슈 위임으로 spawn 된 세션이면 agent_run id — 종료 시 서버가 그 run 을 마감한다.
type ActiveSession = {
  id: string;
  workspaceId: number;
  name: string;
  intent: 'new' | 'resume';
  runId?: number;
  // 위임 세션의 초기 작업 지시 — 연결 직후 서버로 보내 claude 의 첫 prompt 로 전달.
  prompt?: string;
};
// 서버 /api/sessions 응답 메타 (pty.ts SessionMeta 와 일치).
type SessionMeta = {
  id: string;
  name: string;
  workspaceId: number;
  createdAt: number;
  lastActivityAt: number;
  connected: boolean;
};

const SESSION_STORAGE_KEY = 'cortex:agentSession';
const SESSIONS_API = '/api/sessions';
// 디자인 시스템엔 코드용 monospace 폰트 토큰이 없음(number=Spoqa sans, digital=7세그). 터미널은
// 열 정렬상 monospace 필수라 표준 mono 스택 사용 (색·크기만 DS 토큰).
const TERMINAL_FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function loadActive(): { id: string; workspaceId: number } | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as { id?: unknown; workspaceId?: unknown };
    if (typeof s.id === 'string' && typeof s.workspaceId === 'number') {
      return { id: s.id, workspaceId: s.workspaceId };
    }
  } catch {
    // 무시.
  }
  return null;
}

function saveActive(s: ActiveSession | null) {
  if (s)
    localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ id: s.id, workspaceId: s.workspaceId }),
    );
  else localStorage.removeItem(SESSION_STORAGE_KEY);
}

async function fetchSessions(): Promise<SessionMeta[]> {
  try {
    const res = await fetch(SESSIONS_API, { cache: 'no-store' });
    if (!res.ok) return [];
    const data = (await res.json()) as { sessions?: unknown };
    return Array.isArray(data.sessions) ? (data.sessions as SessionMeta[]) : [];
  } catch {
    return [];
  }
}

async function postSessionAction(body: {
  action: 'rename' | 'terminate';
  id: string;
  name?: string;
}) {
  try {
    await fetch(SESSIONS_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    // 무시 — 다음 refresh 에서 실제 상태로 동기화.
  }
}

export function AgentConsole({
  workspaces,
  claudeReady,
  open = true,
  pendingStart = null,
  onPendingConsumed,
}: {
  workspaces: ReadonlyArray<WorkspaceOption>;
  claudeReady: boolean;
  // 드로어 열림 여부 — 열려 있을 때만 세션 목록을 폴링한다(닫혀 있으면 불필요한 부하 방지).
  open?: boolean;
  // 위임 자동 실행 — 있으면 이슈명 세션을 1회 spawn (agentRunId·초기 prompt 를 세션에 묶는다).
  pendingStart?: {
    workspaceId: number;
    sessionName: string;
    agentRunId: number;
    prompt: string;
  } | null;
  onPendingConsumed?: () => void;
}) {
  const [selectedId, setSelectedId] = useState<number>(workspaces[0]?.id ?? 0);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [active, setActive] = useState<ActiveSession | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const killRef = useRef<(() => void) | null>(null);

  const refresh = useCallback(async () => {
    setSessions(await fetchSessions());
  }, []);

  // 마운트: 세션 목록 fetch + 저장된 active 가 아직 살아 있으면 복원.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await fetchSessions();
      if (cancelled) return;
      setSessions(list);
      const stored = loadActive();
      if (stored) {
        const meta = list.find((s) => s.id === stored.id);
        if (meta) {
          setActive({
            id: meta.id,
            workspaceId: meta.workspaceId,
            name: meta.name,
            intent: 'resume',
          });
          setSelectedId(meta.workspaceId);
        } else {
          saveActive(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 드로어가 열려 있는 동안 세션 목록을 주기적으로 새로고침 — 다른 탭/세션의 생성·종료·idle
  // reap 을 라이브로 반영해 "관리되고 있는지" 눈으로 확인 가능하게. 닫혀 있으면 폴링 안 함.
  useEffect(() => {
    if (!open) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 4000);
    return () => window.clearInterval(timer);
  }, [open, refresh]);

  // 위임 자동 실행 — 드로어가 pendingStart 를 주면 이슈명 세션을 1회 spawn 하고 소비한다.
  // runId 를 세션에 묶어 종료 시 서버가 agent_run 을 마감하게 한다.
  useEffect(() => {
    if (!pendingStart) return;
    const next: ActiveSession = {
      id: crypto.randomUUID(),
      workspaceId: pendingStart.workspaceId,
      name: pendingStart.sessionName,
      intent: 'new',
      runId: pendingStart.agentRunId,
      prompt: pendingStart.prompt,
    };
    setActive(next);
    saveActive(next);
    setSelectedId(pendingStart.workspaceId);
    onPendingConsumed?.();
    window.setTimeout(() => void refresh(), 600);
  }, [pendingStart, onPendingConsumed, refresh]);

  function onNew() {
    if (selectedId === 0) return;
    const ws = workspaces.find((w) => w.id === selectedId);
    const next: ActiveSession = {
      id: crypto.randomUUID(),
      workspaceId: selectedId,
      name: t.agents.sessions.defaultName(ws?.projectSlug ?? '세션'),
      intent: 'new',
    };
    setActive(next);
    saveActive(next);
    // 새 세션은 ws 연결 시 서버에 생성됨 — 잠시 후 목록 갱신.
    window.setTimeout(() => void refresh(), 600);
  }

  function onSwitch(meta: SessionMeta) {
    if (active?.id === meta.id) return;
    // 전환 — 현재 패널 unmount 가 ws 만 닫고 서버 세션은 유지(kill 아님). 새 패널이 resume.
    const next: ActiveSession = {
      id: meta.id,
      workspaceId: meta.workspaceId,
      name: meta.name,
      intent: 'resume',
    };
    setActive(next);
    saveActive(next);
    setSelectedId(meta.workspaceId);
  }

  async function onTerminate(meta: SessionMeta) {
    if (active?.id === meta.id) {
      // 활성 세션 — ws 로 즉시 kill + 패널 정리.
      killRef.current?.();
      setActive(null);
      saveActive(null);
    } else {
      await postSessionAction({ action: 'terminate', id: meta.id });
    }
    if (renamingId === meta.id) setRenamingId(null);
    await refresh();
  }

  function beginRename(meta: SessionMeta) {
    setRenamingId(meta.id);
    setRenameValue(meta.name);
  }

  async function commitRename(id: string) {
    if (renamingId !== id) return; // 이미 처리됨 (Enter→blur 중복 방지).
    const name = renameValue.trim();
    setRenamingId(null);
    if (!name) return;
    await postSessionAction({ action: 'rename', id, name });
    setActive((prev) => (prev && prev.id === id ? { ...prev, name } : prev));
    await refresh();
  }

  // 세션 자연 종료(exit) 또는 서버에 세션 없음(gone) 처리. TerminalPane effect 의존성이라 안정 참조.
  const onEnded = useCallback(
    (reason: 'exit' | 'gone') => {
      saveActive(null);
      if (reason === 'gone') setActive(null); // 화면도 비움. exit 면 종료 메시지 보이게 유지.
      void refresh();
    },
    [refresh],
  );

  // 표시 목록 — 서버 세션 + 아직 목록에 안 뜬 갓 만든 active 세션(낙관적).
  const displaySessions: SessionMeta[] =
    active && !sessions.some((s) => s.id === active.id)
      ? [
          {
            id: active.id,
            name: active.name,
            workspaceId: active.workspaceId,
            createdAt: Date.now(),
            lastActivityAt: Date.now(),
            connected: true,
          },
          ...sessions,
        ]
      : sessions;

  return (
    <div className={styles.console}>
      <div className={styles.controls}>
        <label className={styles.pickerLabel}>
          {t.agents.pickerLabel}
          <select
            className={styles.picker}
            value={selectedId}
            onChange={(e) => setSelectedId(Number(e.target.value))}
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id} title={w.localPath}>
                {w.projectSlug} — {w.localPath}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="ds-btn ds-btn--sm ds-btn--filled-blue"
          onClick={onNew}
          disabled={!claudeReady || selectedId === 0}
        >
          <span className="ds-btn__label">{t.agents.sessions.newSession}</span>
        </button>
      </div>

      {!claudeReady && <p className={styles.notReady}>{t.agents.notReady}</p>}

      {displaySessions.length > 0 && (
        <ul className={styles.sessionList} aria-label={t.agents.sessions.listLabel}>
          {displaySessions.map((s) => {
            const wsOpt = workspaces.find((w) => w.id === s.workspaceId);
            const isActive = active?.id === s.id;
            return (
              <li
                key={s.id}
                className={`${styles.sessionRow} ${isActive ? styles.sessionRowActive : ''}`}
              >
                {renamingId === s.id ? (
                  <input
                    className={styles.renameInput}
                    value={renameValue}
                    autoFocus
                    maxLength={60}
                    placeholder={t.agents.sessions.renamePlaceholder}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={() => void commitRename(s.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void commitRename(s.id);
                      else if (e.key === 'Escape') setRenamingId(null);
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className={styles.sessionMain}
                    onClick={() => onSwitch(s)}
                    aria-label={t.agents.sessions.switchAria(s.name)}
                  >
                    <span className={styles.sessionName}>{s.name}</span>
                    <span className={styles.sessionWs}>
                      {wsOpt?.projectSlug ?? `#${s.workspaceId}`}
                    </span>
                    {isActive && (
                      <span className={styles.sessionBadge}>{t.agents.sessions.active}</span>
                    )}
                  </button>
                )}
                <div className={styles.sessionActions}>
                  <button
                    type="button"
                    className={styles.sessionAction}
                    onClick={() => beginRename(s)}
                    aria-label={t.agents.sessions.rename}
                    title={t.agents.sessions.rename}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    className={styles.sessionAction}
                    onClick={() => void onTerminate(s)}
                    aria-label={t.agents.sessions.terminateAria(s.name)}
                    title={t.agents.sessions.terminate}
                  >
                    ×
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {active ? (
        <TerminalPane key={active.id} session={active} registerKill={killRef} onEnded={onEnded} />
      ) : (
        <div className={styles.placeholder}>{t.agents.placeholder}</div>
      )}
    </div>
  );
}

function TerminalPane({
  session,
  registerKill,
  onEnded,
}: {
  session: ActiveSession;
  registerKill: React.MutableRefObject<(() => void) | null>;
  onEnded: (reason: 'exit' | 'gone') => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>('connecting');

  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | null = null;
    let term: Terminal | null = null;
    let observer: ResizeObserver | null = null;

    (async () => {
      const [{ Terminal: TerminalCtor }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
      ]);
      if (disposed || !containerRef.current) return;

      const xterm = new TerminalCtor({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: TERMINAL_FONT,
        theme: {
          background: cssVar('--ds-color-bg-00', '#0b0d12'),
          foreground: cssVar('--ds-color-text-03-high', '#e6e8ee'),
          cursor: cssVar('--ds-color-secondary-01', '#628cf5'),
        },
      });
      term = xterm;
      const fit = new FitAddon();
      xterm.loadAddon(fit);
      xterm.open(containerRef.current);
      fit.fit();

      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      // 위임 세션이면 runId 를 함께 전달 — 서버가 세션 종료 시 그 agent_run 을 마감한다.
      const runIdParam = session.runId != null ? `&runId=${session.runId}` : '';
      // 위임 세션의 초기 prompt 는 URL 대신 연결 직후 메시지로 보낸다(긴 한글 prompt 의 URL 길이
      // 제한 회피). awaitPrompt=1 이면 서버가 prompt 메시지를 받고서 claude 를 spawn 한다.
      const awaitPromptParam = session.intent === 'new' && session.prompt ? '&awaitPrompt=1' : '';
      const url =
        `${proto}://${window.location.host}/api/pty?sessionId=${encodeURIComponent(session.id)}` +
        `&workspaceId=${session.workspaceId}&intent=${session.intent}` +
        `&name=${encodeURIComponent(session.name)}${runIdParam}${awaitPromptParam}` +
        `&cols=${xterm.cols}&rows=${xterm.rows}`;
      const sock = new WebSocket(url);
      socket = sock;

      // '세션 종료'·전환 시 부모가 호출 — 서버에 kill 전송 후 닫기.
      registerKill.current = () => {
        if (sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify({ type: 'kill' }));
        sock.close();
      };

      const sendResize = () => {
        fit.fit();
        if (sock.readyState === WebSocket.OPEN) {
          sock.send(JSON.stringify({ type: 'resize', cols: xterm.cols, rows: xterm.rows }));
        }
      };

      sock.onopen = () => {
        if (disposed) return;
        setStatus('open');
        // 위임 세션: 초기 작업 지시를 보낸다 → 서버가 이걸 받아 claude 를 spawn(positional prompt).
        if (session.intent === 'new' && session.prompt) {
          sock.send(JSON.stringify({ type: 'prompt', data: session.prompt }));
        }
        sendResize();
        xterm.focus();
      };
      sock.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data) as { type: string; data: string };
          if (msg.type === 'output' || msg.type === 'system') xterm.write(msg.data);
          else if (msg.type === 'exit') {
            xterm.write(`\r\n[${t.agents.sessionEnd(msg.data)}]\r\n`);
            onEnded('exit');
          } else if (msg.type === 'gone') {
            onEnded('gone');
          }
        } catch {
          xterm.write(e.data);
        }
      };
      sock.onclose = () => {
        if (!disposed) setStatus((s) => (s === 'error' ? s : 'closed'));
      };
      sock.onerror = () => {
        if (!disposed) setStatus('error');
      };

      xterm.onData((d) => {
        if (sock.readyState === WebSocket.OPEN) {
          sock.send(JSON.stringify({ type: 'input', data: d }));
        }
      });

      observer = new ResizeObserver(() => sendResize());
      observer.observe(containerRef.current);
    })();

    return () => {
      // 언마운트(화면 이동·전환·새로고침)는 ws 만 닫음 — 서버는 세션 유지(reap 전까지). kill 은 종료에서만.
      disposed = true;
      registerKill.current = null;
      observer?.disconnect();
      socket?.close();
      term?.dispose();
    };
  }, [session, registerKill, onEnded]);

  return (
    <div className={styles.pane}>
      <div className={styles.statusBar}>
        <span className={`${styles.dot} ${styles[`dot_${status}`]}`} aria-hidden />
        <span className={styles.statusText}>{t.agents.status[status]}</span>
      </div>
      <div ref={containerRef} className={styles.term} />
    </div>
  );
}
