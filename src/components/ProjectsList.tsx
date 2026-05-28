'use client';

// Phase 10.1 후속 — /projects 카드 list + 로드맵 drawer 통합.
// 사용자 시그널:
// - "점수 부분이 맘에 안 들고 전체적으로 한눈에 안 들어옴" → Gauge 제거, 컴팩트 한 줄 통계
// - "로드맵 누르면 페이지 이동 X, 오른쪽 사이드 드로어" → "로드맵" 버튼이 drawer 토글
// - 노션 스타일 — 드로어 상단 "전체 화면" 아이콘으로 풀 페이지 이동

import { useState } from 'react';
import { ko as t } from '@/copy/ko';
import { ProjectAutoMergeToggle } from './ProjectAutoMergeToggle';
import { ProjectBranchDeleteToggle } from './ProjectBranchDeleteToggle';
import { ProjectReconcileButton } from './ProjectReconcileButton';
import { RoadmapDrawer } from './RoadmapDrawer';
import { WorkspaceCard } from './WorkspaceCard';
import type { ProjectStatsRow } from '@/lib/projects';
import type { ProjectRoadmapView } from '@/lib/roadmap';
import type { WorkspaceView } from '@/lib/workspace';
import styles from './ProjectsList.module.css';

export type ProjectCardData = {
  row: ProjectStatsRow;
  roadmap: ProjectRoadmapView | null;
  workspace: WorkspaceView | null;
};

export function ProjectsList({ cards }: { cards: ReadonlyArray<ProjectCardData> }) {
  const [openId, setOpenId] = useState<number | null>(null);
  const openCard = openId !== null ? cards.find((c) => c.row.id === openId) : null;

  return (
    <>
      <div className={styles.list}>
        {cards.map((c) => (
          <ProjectCard key={c.row.id} card={c} onOpenRoadmap={() => setOpenId(c.row.id)} />
        ))}
      </div>
      {openCard?.roadmap && (
        <RoadmapDrawer view={openCard.roadmap} onClose={() => setOpenId(null)} />
      )}
    </>
  );
}

function ProjectCard({
  card,
  onOpenRoadmap,
}: {
  card: ProjectCardData;
  onOpenRoadmap: () => void;
}) {
  const { row, roadmap } = card;
  const pct = roadmap?.overallPct ?? 0;
  const totalItems = roadmap?.totalItems ?? 0;
  const doneItems = roadmap?.doneItems ?? 0;
  const hasRoadmap = roadmap !== null && roadmap.phases.length > 0;

  return (
    <article className={styles.card}>
      <header className={styles.cardHead}>
        <div className={styles.cardMeta}>
          <span className={styles.cardSlug}>{row.slug}</span>
          {row.name !== row.slug && <span className={styles.cardName}>{row.name}</span>}
        </div>
        <div className={styles.progressInline}>
          <div className={styles.progressTrack} aria-hidden>
            <div className={styles.progressBar} style={{ width: `${pct}%` }} />
          </div>
          <span className={styles.progressLabel}>
            {pct}%
            {hasRoadmap && (
              <span className={styles.progressMeta}>
                {' '}
                · {doneItems} / {totalItems}
              </span>
            )}
          </span>
        </div>
      </header>

      <div className={styles.statRow}>
        <span className={styles.statInline}>
          {t.projects.statInline(row.activePRs, row.mergedPRs, row.avgConfidence)}
        </span>
      </div>

      <div className={styles.actionRow}>
        <ProjectAutoMergeToggle row={row} />
        <ProjectBranchDeleteToggle id={row.id} enabled={row.autoDeleteBranchEnabled} />
        <ProjectReconcileButton projectId={row.id} />
        <button
          type="button"
          className="ds-btn ds-btn--md ds-btn--filled-blue"
          onClick={onOpenRoadmap}
          aria-label={t.projects.drawer.open}
        >
          <span className="ds-btn__label">{t.projects.drawer.open}</span>
        </button>
      </div>

      <WorkspaceCard projectId={row.id} workspace={card.workspace} />
    </article>
  );
}
