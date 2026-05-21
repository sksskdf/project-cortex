'use client';

import { useOptimistic, useTransition } from 'react';
import { ko as t } from '@/copy/ko';
import { toggleProjectAutoMergeAction, type ProjectAutoMergeActionState } from '@/actions/settings';
import type { ProjectAutoMergeRow } from '@/lib/projects';
import styles from '@/app/settings/page.module.css';
import { useState } from 'react';

// 프로젝트 한 행 — slug + 토글 + 결과 메시지. Phase 8 인테이크 마법사가 들어오면
// 거기로 흡수되거나 다중 컬럼 테이블로 확장 예정. 지금은 한 줄 단순 UI.
export function ProjectAutoMergeToggle({ row }: { row: ProjectAutoMergeRow }) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<ProjectAutoMergeActionState>({ kind: 'idle' });
  // server prop 으로 들어온 값을 optimistic 으로 즉시 swap → 토글 클릭 후 stale window 제거.
  const [optimisticEnabled, setOptimisticEnabled] = useOptimistic(
    row.autoMergeEnabled,
    (_current, next: boolean) => next,
  );

  function onToggle() {
    const next = !optimisticEnabled;
    setState({ kind: 'idle' });
    startTransition(async () => {
      setOptimisticEnabled(next);
      const result = await toggleProjectAutoMergeAction(row.id, next);
      setState(result);
    });
  }

  return (
    <div className={styles.projectRow}>
      <div className={styles.projectMeta}>
        <span className={styles.projectSlug}>{row.slug}</span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={optimisticEnabled}
        aria-busy={pending}
        disabled={pending}
        onClick={onToggle}
        className={`ds-btn ds-btn--md ${optimisticEnabled ? 'ds-btn--filled-blue' : 'ds-btn--outlined-basic'}`}
      >
        <span className="ds-btn__label">
          {optimisticEnabled ? t.settings.ai.on : t.settings.ai.off}
        </span>
      </button>
      <ToggleResult state={state} slug={row.slug} />
    </div>
  );
}

function ToggleResult({ state, slug }: { state: ProjectAutoMergeActionState; slug: string }) {
  if (state.kind === 'idle') return null;
  if (state.kind === 'updated') {
    return (
      <span className={`${styles.result} ${styles.resultSuccess}`} role="status" aria-live="polite">
        {state.enabled
          ? t.settings.autoMerge.result.enabled(slug)
          : t.settings.autoMerge.result.disabled(slug)}
      </span>
    );
  }
  if (state.kind === 'not-found') {
    return (
      <span className={`${styles.result} ${styles.resultError}`} role="alert">
        {t.settings.autoMerge.result.notFound}
      </span>
    );
  }
  return (
    <span className={`${styles.result} ${styles.resultError}`} role="alert">
      {t.settings.autoMerge.result.error(state.message)}
    </span>
  );
}
