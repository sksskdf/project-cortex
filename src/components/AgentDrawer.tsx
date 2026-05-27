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

// 위임 자동 실행 — openDrawer 에 넘기면 드로어를 열면서 이슈명 세션을 자동 spawn 하고
// agentRunId 를 세션에 묶는다 (세션 종료 시 agent_run 마감용).
export type PendingStart = {
  workspaceId: number;
  sessionName: string;
  agentRunId: number;
  prompt: string;
};
type AgentDrawerCtx = { openDrawer: (pending?: PendingStart) => void };
const Ctx = createContext<AgentDrawerCtx | null>(null);

export function useAgentDrawer(): AgentDrawerCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAgentDrawer must be used within AgentDrawerProvider');
  return ctx;
}

type Dock = 'right' | 'bottom';
const DOCK_STORAGE_KEY = 'cortex:agentDock';
const WIDTH_STORAGE_KEY = 'cortex:agentDrawerWidth';
const HEIGHT_STORAGE_KEY = 'cortex:agentDrawerHeight';

// 크기 조절 경계: 가로 320px–90vw, 세로 240px–90vh.
const MIN_WIDTH = 320;
const MIN_HEIGHT = 240;

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

function loadDock(): Dock | null {
  try {
    const v = localStorage.getItem(DOCK_STORAGE_KEY);
    return v === 'right' || v === 'bottom' ? v : null;
  } catch {
    return null;
  }
}

function loadSize(key: string): number | null {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : null;
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
  // 위임 시 자동 spawn 할 세션 정보 (1회성). AgentConsole 이 소비하면 null 로 비운다.
  const [pendingStart, setPendingStart] = useState<PendingStart | null>(null);
  const openDrawer = useCallback((pending?: PendingStart) => {
    if (pending) setPendingStart(pending);
    setOpen(true);
  }, []);
  const [dock, setDock] = useState<Dock>('right');
  const [dragging, setDragging] = useState(false);
  // 도킹별 사용자 지정 크기(px). null = 미지정(CSS 기본값 사용).
  const [width, setWidth] = useState<number | null>(null);
  const [height, setHeight] = useState<number | null>(null);
  const dockRef = useRef<Dock>('right');
  const draggingRef = useRef(false);
  const resizingRef = useRef(false);
  const widthRef = useRef<number | null>(null);
  const heightRef = useRef<number | null>(null);

  // 첫 마운트: 저장된 위치/크기 우선, 위치 없으면 화면 비율로 결정 (SSR 안전 — 클라이언트에서만).
  useEffect(() => {
    const initial = loadDock() ?? responsiveDock();
    dockRef.current = initial;
    setDock(initial);
    const w = loadSize(WIDTH_STORAGE_KEY);
    const h = loadSize(HEIGHT_STORAGE_KEY);
    if (w !== null) {
      widthRef.current = w;
      setWidth(w);
    }
    if (h !== null) {
      heightRef.current = h;
      setHeight(h);
    }
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

  // 크기 조절 — 헤더 드래그와 동일하게 포인터 캡처 사용. 오른쪽=가로(왼쪽 가장자리),
  // 하단=세로(위쪽 가장자리). 전체화면(expanded)에선 핸들이 숨겨져 호출되지 않는다.
  const onResizePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    resizingRef.current = true;
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onResizePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!resizingRef.current) return;
    if (dockRef.current === 'right') {
      // 왼쪽 가장자리를 끌면 패널 우측은 고정 → 폭 = 화면너비 - 포인터X.
      const next = clamp(window.innerWidth - e.clientX, MIN_WIDTH, window.innerWidth * 0.9);
      widthRef.current = next;
      setWidth(next);
    } else {
      // 위쪽 가장자리를 끌면 패널 하단은 고정 → 높이 = 화면높이 - 포인터Y.
      const next = clamp(window.innerHeight - e.clientY, MIN_HEIGHT, window.innerHeight * 0.9);
      heightRef.current = next;
      setHeight(next);
    }
  }, []);

  const onResizePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!resizingRef.current) return;
    resizingRef.current = false;
    setDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // 이미 해제됨 — 무시.
    }
    try {
      if (widthRef.current !== null)
        localStorage.setItem(WIDTH_STORAGE_KEY, String(widthRef.current));
      if (heightRef.current !== null)
        localStorage.setItem(HEIGHT_STORAGE_KEY, String(heightRef.current));
    } catch {
      // 저장 실패해도 동작엔 영향 없음.
    }
  }, []);

  // 전체화면이면 인라인 크기 무시(CSS 가 전체화면 처리). 도킹별로 해당 축만 적용.
  const panelStyle: React.CSSProperties = expanded
    ? {}
    : dock === 'right'
      ? width !== null
        ? { width }
        : {}
      : height !== null
        ? { height }
        : {};

  return (
    <Ctx.Provider value={{ openDrawer }}>
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
        style={panelStyle}
      >
        <div
          className={styles.resizeHandle}
          role="separator"
          aria-label={t.agents.resize}
          aria-orientation={dock === 'right' ? 'vertical' : 'horizontal'}
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerUp}
        />
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
            <AgentConsole
              workspaces={workspaces}
              claudeReady={claudeReady}
              open={open}
              pendingStart={pendingStart}
              onPendingConsumed={() => setPendingStart(null)}
            />
          )}
        </div>
      </aside>
    </Ctx.Provider>
  );
}
