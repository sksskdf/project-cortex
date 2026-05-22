// Phase 10.1 후속 — 대시보드 프로젝트 진척 위젯.
// 사용자 시그널 (2026-05-22): "대시보드에서도 프로젝트 관련 뷰잉 위젯이 있으면 좋을 것 같고".

import Link from 'next/link';
import { ko as t } from '@/copy/ko';
import type { DashboardProjectRow } from '@/lib/roadmap';
import styles from './DashboardProjectsWidget.module.css';

export function DashboardProjectsWidget({ rows }: { rows: ReadonlyArray<DashboardProjectRow> }) {
  if (rows.length === 0) {
    return <div className={styles.empty}>{t.dashboard.projectsWidget.empty}</div>;
  }
  return (
    <ul className={styles.list}>
      {rows.map((row) => (
        <li key={row.projectId} className={styles.item}>
          <Link href={`/projects/${row.projectId}/roadmap`} className={styles.link}>
            <div className={styles.head}>
              <span className={styles.slug}>{row.slug}</span>
              <span className={styles.pct}>{row.overallPct}%</span>
            </div>
            <div className={styles.bar} aria-hidden>
              <div className={styles.barFill} style={{ width: `${row.overallPct}%` }} />
            </div>
            <div className={styles.meta}>
              {row.openItemCount > 0
                ? t.dashboard.projectsWidget.openCount(row.openItemCount)
                : t.dashboard.projectsWidget.noOpen}
              {row.totalItems > 0 && (
                <span className={styles.metaCount}>
                  {' · '}
                  {row.doneItems} / {row.totalItems}
                </span>
              )}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
