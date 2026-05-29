'use client';

// Phase 10.1 후속 — 남은 작업 Phase 별 그룹 + 펼치기/접기.
// 사용자 시그널 (2026-05-22):
// - "PHASE 별로 클릭했을 때 토글로 펼쳐지면서 상세 내용도" → 그룹 + collapsible
// - "이미 진행된 PHASE 의 항목이 표시 안 됨" → 펼치면 done 도 함께 (line-through)
// - "PHASE 하위 항목이 PR # 와 연결되고 누르면 PR 상세로" → doneByPrNumber #N 링크

import Link from 'next/link';
import { useState } from 'react';
import { ko as t } from '@/copy/ko';
import { StatusChip } from '@/components/StatusChip';
import type { OpenItemGroupView } from '@/lib/roadmap';
import styles from './RoadmapOpenItems.module.css';

export function RoadmapOpenItems({ groups }: { groups: ReadonlyArray<OpenItemGroupView> }) {
  const totalOpen = groups.reduce((sum, g) => sum + g.openCount, 0);

  return (
    <section className={styles.section} aria-label={t.roadmap.openItems.ariaLabel}>
      <header className={styles.head}>
        <h2 className={styles.title}>{t.roadmap.openItems.title}</h2>
        <span className={styles.count}>{t.roadmap.openItems.count(totalOpen)}</span>
      </header>
      {totalOpen === 0 ? (
        <div className={styles.empty}>{t.roadmap.openItems.empty}</div>
      ) : (
        <ul className={styles.groupList}>
          {groups.map((group) => (
            <PhaseGroup key={group.phaseId} group={group} />
          ))}
        </ul>
      )}
    </section>
  );
}

function PhaseGroup({ group }: { group: OpenItemGroupView }) {
  // 디폴트: open 있으면 펼침, 다 done 이면 접힘.
  const [expanded, setExpanded] = useState(group.openCount > 0);
  const allDone = group.openCount === 0 && group.totalCount > 0;

  return (
    <li className={`${styles.group} ${allDone ? styles.groupDone : ''}`}>
      <button
        type="button"
        className={styles.groupHead}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className={styles.chevron} aria-hidden>
          {expanded ? '▾' : '▸'}
        </span>
        <span className={styles.phaseRef}>{t.roadmap.openItems.phaseRef(group.phaseKey)}</span>
        <span className={styles.phaseTitle}>{group.phaseTitle}</span>
        <span className={styles.groupMeta}>
          {allDone
            ? t.roadmap.openItems.allDone
            : t.roadmap.openItems.openOf(group.openCount, group.totalCount)}
        </span>
      </button>
      {expanded && (
        <div className={styles.groupBody}>
          {group.phaseGoal && <p className={styles.phaseGoal}>{group.phaseGoal}</p>}
          {group.items.length === 0 ? (
            <div className={styles.groupEmpty}>{t.roadmap.openItems.groupEmpty}</div>
          ) : (
            <ul className={styles.itemList}>
              {group.items.map((it) => (
                <li
                  key={it.id}
                  className={`${styles.item} ${it.status === 'done' ? styles.itemDone : ''}`}
                >
                  <StatusChip kind="roadmap" status={it.status} />
                  <span className={styles.itemTitle}>{it.title}</span>
                  {it.doneByPrId !== null && (
                    <Link
                      href={`/pr/${it.doneByPrId}`}
                      className={styles.prLink}
                      title={t.roadmap.openItems.prLinkTip}
                    >
                      #{it.doneByPrNumber ?? it.doneByPrId}
                    </Link>
                  )}
                  {it.source === 'git' && <span className={styles.sourceGit}>git</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}
