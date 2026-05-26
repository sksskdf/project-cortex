'use client';

// Phase 13 — 전역 에이전트 드로어. AppShell(루트 레이아웃)에 마운트되어 화면을 이동해도
// 세션(WebSocket/xterm)이 유지된다. 패널은 항상 마운트하고 open/expanded 는 CSS 로만 토글 —
// 닫아도 AgentConsole 이 unmount 되지 않아 세션이 살아 있다. 새로고침 유지는 AgentConsole 의
// 서버 detached 세션이 담당. 사이드바 '에이전트' 와 우하단 런처가 useAgentDrawer 로 연다.
//
// 도킹 위치(오른쪽/하단): 가로보다 세로가 긴 화면(세워둔 모니터)에선 오른쪽 사이드가 불편하므로
// 첫 진입 시 화면 비율로 기본값을 정한다(세로>가로 → 하단). 사용자가 헤더를 드래그하면 포인터가
// 가까운 가장자리로 재도킹되고, 그 위치를 localStorage 에 저장해 다음에 복원한다.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
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

type Dock = 'right' | 'bottom';
const DOCK_STORAGE_KEY = 'cortex:agentDock';

function loadDock(): Dock | null {
  try {
    const v = localStorage.getItem(DOCK_STORAGE_KEY);
    return v === 'right' || v === 'bottom' ? v : null;
  } catch {
    return null;
  }
}

// 세로가 가로보다 길면(세워둔 모니터) 하단, 아니면 오른쪽.
function responsiveDock(): Dock {
  return window.innerHeight > window.innerWidth ? 'bottom' : 'right';
}

// 포인터가 오른쪽 가장자리와 하단 가장자리 중 어느 쪽에 더 가까운지로 도킹 위치 결정.
function dockFromPointer(x: number, y: number): Dock {
  const toRight = window.innerWidth - x;
  const toBottom = window.innerHeight - y;
  return toBottom <= toRight ? 'bottom' : 'right';
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
  const [dock, setDock] = useState<Dock>('right');
  const [dragging, setDragging] = useState(false);
  const dockRef = useRef<Dock>('right');
  const draggingRef = useRef(false);

  // 첫 마운트: 저장된 위치 우선, 없으면 화면 비율로 결정 (SSR 안전 — 클라이언트에서만).
  useEffect(() => {
    const initial = loadDock() ?? responsiveDock();
    dockRef.current = initial;
    setDock(initial);
  }, []);

  const onHeadPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // 헤더 버튼(전체화면·닫기) 클릭은 드래그로 가로채지 않음.
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    draggingRef.current = true;
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onHeadPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const next = dockFromPointer(e.clientX, e.clientY);
    if (next !== dockRef.current) {
      dockRef.current = next;
      setDock(next);
    }
  }, []);

  const onHeadPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // 이미 해제됨 — 무시.
    }
    try {
      localStorage.setItem(DOCK_STORAGE_KEY, dockRef.current);
    } catch {
      // 저장 실패해도 동작엔 영향 없음.
    }
  }, []);

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
        className={[
          styles.panel,
          dock === 'bottom' ? styles.dockBottom : styles.dockRight,
          open ? styles.panelOpen : '',
          expanded ? styles.panelExpanded : '',
          dragging ? styles.dragging : '',
        ].join(' ')}
        aria-hidden={!open}
        aria-label={t.agents.title}
      >
        <div
          className={styles.head}
          onPointerDown={onHeadPointerDown}
          onPointerMove={onHeadPointerMove}
          onPointerUp={onHeadPointerUp}
          title={t.agents.dragHint}
        >
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
