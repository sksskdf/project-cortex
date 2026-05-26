'use client';

// Phase 13 — 전역 에이전트 드로어. AppShell(루트 레이아웃)에 마운트되어 화면을 이동해도
// 세션(WebSocket/xterm)이 유지된다. 패널은 항상 마운트하고 open/expanded 는 CSS 로만 토글 —
// 닫아도 AgentConsole 이 unmount 되지 않아 세션이 살아 있다. (새로고침 유지는 서버 detached
// 세션이 필요 — 후속 단계.) 사이드바 '에이전트' 와 우하단 런처가 useAgentDrawer 로 연다.

import { createContext, useContext, useState } from 'react';
import Link from 'next/link';
import { ko as t } from '@/copy/ko';
import { AgentConsole, type WorkspaceOption } from './AgentConsole';
import styles from './AgentDrawer.module.css';

type AgentDrawerCtx = { openDrawer: () => void };
const Ctx = createContext<AgentDrawerCtx | null>(null);

export function useAgentDrawer(): AgentDrawerCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAgentDrawer must be used within AgentDrawerProvider');
  return ctx;
}

const launcherIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polyline points="4 17 10 11 4 5" />
    <line x1="12" y1="19" x2="20" y2="19" />
  </svg>
);

const expandIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polyline points="15 3 21 3 21 9" />
    <polyline points="9 21 3 21 3 15" />
    <line x1="21" y1="3" x2="14" y2="10" />
    <line x1="3" y1="21" x2="10" y2="14" />
  </svg>
);

const collapseIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polyline points="4 14 10 14 10 20" />
    <polyline points="20 10 14 10 14 4" />
    <line x1="14" y1="10" x2="21" y2="3" />
    <line x1="3" y1="21" x2="10" y2="14" />
  </svg>
);

export function AgentDrawerProvider({
  workspaces,
  claudeReady,
  children,
}: {
  workspaces: ReadonlyArray<WorkspaceOption>;
  claudeReady: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);

  return (
    <Ctx.Provider value={{ openDrawer: () => setOpen(true) }}>
      {children}

      {!open && (
        <button
          type="button"
          className={styles.launcher}
          onClick={() => setOpen(true)}
          aria-label={t.agents.launcher}
          title={t.agents.launcher}
        >
          {launcherIcon}
        </button>
      )}

      <aside
        className={`${styles.panel} ${open ? styles.panelOpen : ''} ${expanded ? styles.panelExpanded : ''}`}
        aria-hidden={!open}
        aria-label={t.agents.title}
      >
        <div className={styles.head}>
          <span className={styles.headTitle}>{t.agents.title}</span>
          <div className={styles.headActions}>
            <button
              type="button"
              className={styles.headBtn}
              onClick={() => setExpanded((v) => !v)}
              aria-label={expanded ? t.agents.collapse : t.agents.expand}
              title={expanded ? t.agents.collapse : t.agents.expand}
            >
              {expanded ? collapseIcon : expandIcon}
            </button>
            <button
              type="button"
              className={styles.headBtn}
              onClick={() => setOpen(false)}
              aria-label={t.agents.close}
              title={t.agents.close}
            >
              ×
            </button>
          </div>
        </div>

        <div className={styles.body}>
          {workspaces.length === 0 ? (
            <div className={styles.empty}>
              <strong>{t.agents.empty.title}</strong>
              <p>{t.agents.empty.desc}</p>
              <Link className="ds-btn ds-btn--sm ds-btn--outlined-basic" href="/projects">
                <span className="ds-btn__label">{t.agents.empty.cta}</span>
              </Link>
            </div>
          ) : (
            <AgentConsole workspaces={workspaces} claudeReady={claudeReady} />
          )}
        </div>
      </aside>
    </Ctx.Provider>
  );
}
