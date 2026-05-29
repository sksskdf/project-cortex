'use client';

// Phase 10.1 후속 — 로드맵을 페이지 이동 없이 오른쪽 사이드 드로어로 표시.
// 사용자 시그널 (2026-05-22): "로드맵 누르면 페이지 이동하는게 아니라 오른쪽 사이드에
// 우선 표시하고 노션처럼 사이드 상단에 전체 화면 확장 아이콘 누르면 전체로 확장".
// 간편/빠른 조회가 목표 — 편집은 전체 화면 (/projects/[id]/roadmap) 에서.

import Link from 'next/link';
import { ko as t } from '@/copy/ko';
import { RoadmapOpenItems } from './RoadmapOpenItems';
import { useFocusTrap } from './useFocusTrap';
import type { ProjectRoadmapView } from '@/lib/roadmap';
import styles from './RoadmapDrawer.module.css';

export function RoadmapDrawer({
  view,
  onClose,
}: {
  view: ProjectRoadmapView;
  onClose: () => void;
}) {
  // 포커스 트랩 + 초기 포커스 + Escape 닫기 + 포커스 복원.
  const drawerRef = useFocusTrap<HTMLElement>({ onClose });

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} aria-hidden />
      <aside
        ref={drawerRef}
        className={styles.drawer}
        role="dialog"
        aria-modal="true"
        aria-label={`${view.projectSlug} ${t.projects.drawer.title}`}
      >
        <header className={styles.head}>
          <div className={styles.titleBlock}>
            <span className={styles.slug}>{view.projectSlug}</span>
            <h2 className={styles.title}>{t.projects.drawer.title}</h2>
          </div>
          <div className={styles.headActions}>
            <Link
              href={`/projects/${view.projectId}/roadmap`}
              className={styles.iconBtn}
              aria-label={t.projects.drawer.expandAria}
              title={t.projects.drawer.expand}
            >
              <ExpandIcon />
            </Link>
            <button
              type="button"
              className={styles.iconBtn}
              onClick={onClose}
              aria-label={t.projects.drawer.close}
              title={t.projects.drawer.close}
            >
              <CloseIcon />
            </button>
          </div>
        </header>

        <div className={styles.body}>
          <div className={styles.overall}>
            <div className={styles.overallTop}>
              <span className={styles.overallPct}>{view.overallPct}%</span>
              <span className={styles.overallMeta}>
                {view.doneItems} / {view.totalItems}
              </span>
            </div>
            <div className={styles.overallBar} aria-hidden>
              <div className={styles.overallBarFill} style={{ width: `${view.overallPct}%` }} />
            </div>
          </div>

          {view.phases.length === 0 ? (
            <div className={styles.empty}>{t.projects.drawer.empty}</div>
          ) : (
            <RoadmapOpenItems groups={view.openItemGroups} />
          )}
        </div>
      </aside>
    </>
  );
}

function ExpandIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1={21} y1={3} x2={14} y2={10} />
      <line x1={3} y1={21} x2={10} y2={14} />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1={18} y1={6} x2={6} y2={18} />
      <line x1={6} y1={6} x2={18} y2={18} />
    </svg>
  );
}
