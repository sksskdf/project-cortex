'use client';

// Phase 10.1 후속 — /projects 카드 list + 로드맵 drawer 통합.
// 사용자 시그널:
// - "점수 부분이 맘에 안 들고 전체적으로 한눈에 안 들어옴" → Gauge 제거, 컴팩트 한 줄 통계
// - "로드맵 누르면 페이지 이동 X, 오른쪽 사이드 드로어" → "로드맵" 버튼이 drawer 토글
// - 노션 스타일 — 드로어 상단 "전체 화면" 아이콘으로 풀 페이지 이동

import { useState } from 'react';
import { ko as t } from '@/copy/ko';
import {
  toggleProjectAiReviewAction,
  toggleProjectAutoDeleteBranchAction,
  toggleProjectAutoFixTestsAction,
  toggleProjectAutoResolveChangesAction,
  toggleProjectAutoResolveConflictsAction,
} from '@/actions/settings';
import { ProjectAutomationToggle } from './ProjectAutomationToggle';
import { ProjectAutoMergeToggle } from './ProjectAutoMergeToggle';
import { ProjectMuteToggle } from './ProjectMuteToggle';
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
          <span className={styles.cardSlug}>
            {row.slug}
            {row.muted && <span className={styles.mutedBadge}>{t.projects.mutedBadge}</span>}
          </span>
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

      <div className={styles.toggleGroup}>
        <span className={styles.toggleCaption}>{t.projects.automation}</span>
        {/* 마스터 스위치 'Cortex 관리' — 나머지 자동화를 gating 하므로 맨 앞에 분리. */}
        <div className={styles.masterSwitch}>
          <ProjectMuteToggle id={row.id} muted={row.muted} />
        </div>
        {/* 뮤트(Cortex 관리 OFF) 면 하위 자동화는 동작하지 않음 — 흐리게 + OFF + 비활성. */}
        <div className={`${styles.switches} ${row.muted ? styles.switchesDimmed : ''}`}>
          <ProjectAutomationToggle
            label={t.projects.action.aiReview}
            ariaLabel={t.projects.aiReviewAria}
            enabled={row.aiReviewEnabled}
            disabled={row.muted}
            action={(next) => toggleProjectAiReviewAction(row.id, next)}
          />
          <ProjectAutoMergeToggle row={row} disabled={row.muted} />
          <ProjectAutomationToggle
            label={t.projects.action.autoResolve}
            ariaLabel={t.projects.autoResolveAria}
            enabled={row.autoResolveConflictsEnabled}
            disabled={row.muted}
            action={(next) => toggleProjectAutoResolveConflictsAction(row.id, next)}
          />
          <ProjectAutomationToggle
            label={t.projects.action.autoFixTests}
            ariaLabel={t.projects.autoFixTestsAria}
            enabled={row.autoFixTestsEnabled}
            disabled={row.muted}
            action={(next) => toggleProjectAutoFixTestsAction(row.id, next)}
          />
          <ProjectAutomationToggle
            label={t.projects.action.resolveChanges}
            ariaLabel={t.projects.resolveChangesAria}
            enabled={row.autoResolveChangesEnabled}
            disabled={row.muted}
            action={(next) => toggleProjectAutoResolveChangesAction(row.id, next)}
          />
          <ProjectAutomationToggle
            label={t.projects.action.branchDelete}
            ariaLabel={t.projects.branchDeleteAria}
            enabled={row.autoDeleteBranchEnabled}
            disabled={row.muted}
            action={(next) => toggleProjectAutoDeleteBranchAction(row.id, next)}
          />
        </div>
      </div>

      <div className={styles.actionRow}>
        <button
          type="button"
          className="ds-btn ds-btn--md ds-btn--filled-blue"
          onClick={onOpenRoadmap}
          aria-label={t.projects.drawer.open}
        >
          <span className="ds-btn__label">{t.projects.drawer.open}</span>
        </button>
        <ProjectReconcileButton projectId={row.id} />
      </div>

      <WorkspaceCard projectId={row.id} workspace={card.workspace} />
    </article>
  );
}
