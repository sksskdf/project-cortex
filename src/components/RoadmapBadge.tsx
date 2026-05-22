// Phase 10 — PR 상세 페이지에 노출되는 로드맵 연결 배지.
// PR body 의 'Closes #PHASE-N' / 'Closes #ITEM-N' 매칭으로 연결된 phase/item 들을 표시.
// auto-done 된 항목엔 ✓ 배지.

import Link from 'next/link';
import { ko as t } from '@/copy/ko';
import type { PRRoadmapLink } from '@/lib/roadmap';
import styles from './RoadmapBadge.module.css';

export function RoadmapBadge({
  links,
  projectId,
}: {
  links: ReadonlyArray<PRRoadmapLink>;
  projectId: number;
}) {
  if (links.length === 0) return null;
  return (
    <section className={styles.wrap} aria-label={t.roadmap.prLinks.ariaLabel}>
      <div className={styles.title}>{t.roadmap.prLinks.title}</div>
      <ul className={styles.list}>
        {links.map((link) => (
          <li key={`${link.kind}-${link.id}`} className={styles.item}>
            <Link href={`/projects/${projectId}/roadmap`} className={styles.itemLink}>
              <span className={styles.itemKey}>
                {link.kind === 'phase'
                  ? t.roadmap.prLinks.phaseLabel(link.phaseKey)
                  : t.roadmap.prLinks.itemLabel(link.id)}
              </span>
              <span className={styles.itemTitle}>{link.title}</span>
              {link.autoDone && (
                <span className={styles.autoDone} aria-label={t.roadmap.item.autoDoneBadge}>
                  ✓ {t.roadmap.item.autoDoneBadge}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
