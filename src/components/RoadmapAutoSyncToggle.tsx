'use client';

// Phase 10.4 — UI 로드맵 편집을 git 으로 자동 sync 할지 프로젝트별 토글(기본 OFF, opt-in).
// 켜면 RoadmapBoard 편집 시 fire-and-forget 으로 롤링 PR 에 누적 반영. roadmap.md 만.

import { useState, useTransition } from 'react';
import { ko as t } from '@/copy/ko';
import { toggleRoadmapAutoSyncAction } from '@/actions/project-meta';
import styles from './RoadmapSyncButton.module.css';

export function RoadmapAutoSyncToggle({
  projectId,
  initial,
}: {
  projectId: number;
  initial: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  function onToggle() {
    const next = !enabled;
    setEnabled(next);
    setError(null);
    startTransition(async () => {
      const r = await toggleRoadmapAutoSyncAction(projectId, next);
      if (r.kind === 'updated') setEnabled(r.enabled);
      else {
        setEnabled(initial);
        if (r.kind === 'error') setError(r.message);
      }
    });
  }

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-busy={pending}
        disabled={pending}
        onClick={onToggle}
        title={t.roadmap.autoSync.hint}
        className={`ds-btn ds-btn--md ${enabled ? 'ds-btn--filled-blue' : 'ds-btn--outlined-basic'}`}
      >
        <span className="ds-btn__label">
          {enabled ? t.roadmap.autoSync.on : t.roadmap.autoSync.off}
        </span>
      </button>
      {error && (
        <span className={`${styles.result} ${styles.resultError}`} role="alert">
          {t.roadmap.autoSync.error(error)}
        </span>
      )}
    </div>
  );
}
