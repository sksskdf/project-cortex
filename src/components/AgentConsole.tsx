'use client';

// Phase 13 — 에이전트 터미널 콘솔. 워크스페이스 선택 → claude CLI 세션 spawn → xterm.js 로
// PTY 스트림 입출력. WebSocket(/api/pty)으로 커스텀 서버의 node-pty 와 연결됩니다.
//
// 새로고침 유지(2단계): 세션마다 sessionId(UUID)를 localStorage 에 저장. 새로고침 후 마운트 시
// 같은 sessionId 로 intent=resume 재접속 → 서버가 scrollback replay. 세션이 이미 끝났으면
// 서버가 'gone' 통지 → 정리. '세션 종료' 는 서버에 'kill' 전송으로 즉시 정리.

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
type SessionState = { id: string; workspaceId: number; intent: 'new' | 'resume' };

const SESSION_STORAGE_KEY = 'cortex:agentSession';
// 디자인 시스템엔 코드용 monospace 폰트 토큰이 없음(number=Spoqa sans, digital=7세그). 터미널은
// 열 정렬상 monospace 필수라 표준 mono 스택 사용 (색·크기만 DS 토큰).
const TERMINAL_FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function loadSession(): SessionState | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as { id?: unknown; workspaceId?: unknown };
    if (typeof s.id === 'string' && typeof s.workspaceId === 'number') {
      return { id: s.id, workspaceId: s.workspaceId, intent: 'resume' };
    }
  } catch {
    // 무시.
  }
  return null;
}

function saveSession(s: SessionState | null) {
  if (s)
    localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ id: s.id, workspaceId: s.workspaceId }),
    );
  else localStorage.removeItem(SESSION_STORAGE_KEY);
}

export function AgentConsole({
  workspaces,
  claudeReady,
}: {
  workspaces: ReadonlyArray<WorkspaceOption>;
  claudeReady: boolean;
}) {
  const [selectedId, setSelectedId] = useState<number>(workspaces[0]?.id ?? 0);
  const [session, setSession] = useState<SessionState | null>(null);
  const killRef = useRef<(() => void) | null>(null);

  // 새로고침 후 자동 재개 — 저장된 세션이 있으면 reattach.
  useEffect(() => {
    const restored = loadSession();
    if (restored) {
      setSession(restored);
      setSelectedId(restored.workspaceId);
    }
  }, []);

  function startSession(id: string, workspaceId: number) {
    const next: SessionState = { id, workspaceId, intent: 'new' };
    setSession(next);
    saveSession(next);
  }

  function onStart() {
    startSession(crypto.randomUUID(), selectedId);
  }

  function onRestart() {
    killRef.current?.();
    startSession(crypto.randomUUID(), session?.workspaceId ?? selectedId);
  }

  function onStop() {
    killRef.current?.();
    setSession(null);
    saveSession(null);
  }

  // 세션 자연 종료(claude 종료=exit) 또는 서버에 세션 없음(gone) 처리.
  // TerminalPane effect 의 의존성에 들어가므로 안정 참조 (useCallback) — 매 렌더 재연결 방지.
  const onEnded = useCallback((reason: 'exit' | 'gone') => {
    saveSession(null); // 죽은 세션을 새로고침 때 되살리지 않도록.
    if (reason === 'gone') setSession(null); // 화면도 비움. exit 면 종료 메시지 보이게 유지.
  }, []);

  return (
    <div className={styles.console}>
      <div className={styles.controls}>
        <label className={styles.pickerLabel}>
          {t.agents.pickerLabel}
          <select
            className={styles.picker}
            value={selectedId}
            onChange={(e) => setSelectedId(Number(e.target.value))}
            disabled={session !== null}
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id} title={w.localPath}>
                {w.projectSlug} — {w.localPath}
              </option>
            ))}
          </select>
        </label>

        {session ? (
          <>
            <button
              type="button"
              className="ds-btn ds-btn--sm ds-btn--outlined-basic"
              onClick={onRestart}
            >
              <span className="ds-btn__label">{t.agents.restart}</span>
            </button>
            <button type="button" className="ds-btn ds-btn--sm ds-btn--filled-red" onClick={onStop}>
              <span className="ds-btn__label">{t.agents.stop}</span>
            </button>
          </>
        ) : (
          <button
            type="button"
            className="ds-btn ds-btn--sm ds-btn--filled-blue"
            onClick={onStart}
            disabled={!claudeReady || selectedId === 0}
          >
            <span className="ds-btn__label">{t.agents.start}</span>
          </button>
        )}
      </div>

      {!claudeReady && <p className={styles.notReady}>{t.agents.notReady}</p>}

      {session ? (
        <TerminalPane key={session.id} session={session} registerKill={killRef} onEnded={onEnded} />
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
  session: SessionState;
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
      const url =
        `${proto}://${window.location.host}/api/pty?sessionId=${encodeURIComponent(session.id)}` +
        `&workspaceId=${session.workspaceId}&intent=${session.intent}&cols=${xterm.cols}&rows=${xterm.rows}`;
      const sock = new WebSocket(url);
      socket = sock;

      // '세션 종료'(stop)·재시작 시 부모가 호출 — 서버에 kill 전송 후 닫기.
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
      // 언마운트(화면 이동·새로고침)는 ws 만 닫음 — 서버는 세션 유지(reap 전까지). kill 은 stop 에서만.
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
