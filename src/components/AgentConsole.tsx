'use client';

// Phase 13 — /agents 터미널 콘솔. 워크스페이스 선택 → claude CLI 세션 spawn → xterm.js 로
// PTY 스트림 입출력. WebSocket(/api/pty)으로 커스텀 서버의 node-pty 와 연결됩니다.

import { useEffect, useRef, useState } from 'react';
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

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function AgentConsole({
  workspaces,
  claudeReady,
}: {
  workspaces: ReadonlyArray<WorkspaceOption>;
  claudeReady: boolean;
}) {
  const [selectedId, setSelectedId] = useState<number>(workspaces[0]?.id ?? 0);
  const [session, setSession] = useState<{ id: number; key: number } | null>(null);

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
              onClick={() => setSession({ id: selectedId, key: Date.now() })}
            >
              <span className="ds-btn__label">{t.agents.restart}</span>
            </button>
            <button
              type="button"
              className="ds-btn ds-btn--sm ds-btn--filled-red"
              onClick={() => setSession(null)}
            >
              <span className="ds-btn__label">{t.agents.stop}</span>
            </button>
          </>
        ) : (
          <button
            type="button"
            className="ds-btn ds-btn--sm ds-btn--filled-blue"
            onClick={() => setSession({ id: selectedId, key: Date.now() })}
            disabled={!claudeReady || selectedId === 0}
          >
            <span className="ds-btn__label">{t.agents.start}</span>
          </button>
        )}
      </div>

      {!claudeReady && <p className={styles.notReady}>{t.agents.notReady}</p>}

      {session ? (
        <TerminalPane workspaceId={session.id} sessionKey={session.key} />
      ) : (
        <div className={styles.placeholder}>{t.agents.placeholder}</div>
      )}

      <p className={styles.hint}>{t.agents.hint}</p>
    </div>
  );
}

function TerminalPane({ workspaceId, sessionKey }: { workspaceId: number; sessionKey: number }) {
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
        fontFamily: cssVar('--ds-typography-font-family-number', 'ui-monospace, monospace'),
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
      const url = `${proto}://${window.location.host}/api/pty?workspaceId=${workspaceId}&cols=${xterm.cols}&rows=${xterm.rows}`;
      const sock = new WebSocket(url);
      socket = sock;

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
          else if (msg.type === 'exit') xterm.write(`\r\n[${t.agents.sessionEnd(msg.data)}]\r\n`);
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
      disposed = true;
      observer?.disconnect();
      socket?.close();
      term?.dispose();
    };
  }, [workspaceId, sessionKey]);

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
