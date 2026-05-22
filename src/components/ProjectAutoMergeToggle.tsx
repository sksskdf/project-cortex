'use client';

import { useOptimistic, useState, useTransition } from 'react';
import { ko as t } from '@/copy/ko';
import { toggleProjectAutoMergeAction, type ProjectAutoMergeActionState } from '@/actions/settings';
import type { ProjectAutoMergeRow } from '@/lib/projects';
import styles from './ProjectAutoMergeToggle.module.css';

export function ProjectAutoMergeToggle({ row }: { row: ProjectAutoMergeRow }) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<ProjectAutoMergeActionState>({ kind: 'idle' });
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
    <div className={styles.wrap}>
      <button
        type="button"
        role="switch"
        aria-checked={optimisticEnabled}
        aria-busy={pending}
        disabled={pending}
        onClick={onToggle}
        aria-label={t.projects.autoMergeAria(optimisticEnabled)}
        title={t.projects.autoMergeAria(optimisticEnabled)}
        className={`ds-btn ds-btn--md ${optimisticEnabled ? 'ds-btn--filled-blue' : 'ds-btn--outlined-basic'}`}
      >
        <span className="ds-btn__label">
          {t.projects.action.autoMerge} {optimisticEnabled ? t.settings.ai.on : t.settings.ai.off}
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
          ? t.settings.autoMerge.result.enabled(slug, state.retriagedCount)
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
