// Phase 10.1 — 사용자 시그널 ("남은 작업 목록을 확인할 수 있어야 함"). Phase 카드와
// 별개로 진행 중 + 예정 산출물만 모은 평탄 리스트. 한눈에 "다음에 뭐 할지" 가시.

import { ko as t } from '@/copy/ko';
import type { OpenItemView } from '@/lib/roadmap';
import styles from './RoadmapOpenItems.module.css';

const statusDotClass: Record<'planned' | 'in-progress', string> = {
  planned: styles.dotPlanned,
  'in-progress': styles.dotInProgress,
};

export function RoadmapOpenItems({ items }: { items: ReadonlyArray<OpenItemView> }) {
  return (
    <section className={styles.section} aria-label={t.roadmap.openItems.ariaLabel}>
      <header className={styles.head}>
        <h2 className={styles.title}>{t.roadmap.openItems.title}</h2>
        <span className={styles.count}>{t.roadmap.openItems.count(items.length)}</span>
      </header>
      {items.length === 0 ? (
        <div className={styles.empty}>{t.roadmap.openItems.empty}</div>
      ) : (
        <ul className={styles.list}>
          {items.map((it) => (
            <li key={it.id} className={styles.item}>
              <span className={`${styles.dot} ${statusDotClass[it.status]}`} aria-hidden />
              <span className={styles.phaseRef}>{t.roadmap.openItems.phaseRef(it.phaseKey)}</span>
              <span className={styles.itemTitle}>{it.title}</span>
              {it.source === 'git' && <span className={styles.sourceGit}>git</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
