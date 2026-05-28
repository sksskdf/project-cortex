'use client';

import { useOptimistic, useState, useTransition } from 'react';
import { ko as t } from '@/copy/ko';
import { toggleProjectAutoMergeAction, type ProjectAutoMergeActionState } from '@/actions/settings';
import type { ProjectAutoMergeRow } from '@/lib/projects';
import { ToggleSwitch } from './ToggleSwitch';
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

  // 에러/미발견은 스위치 인라인 에러로, 성공 메시지(재트라이아지 수)는 행 아래에 표시.
  const error =
    state.kind === 'error'
      ? t.settings.autoMerge.result.error(state.message)
      : state.kind === 'not-found'
        ? t.settings.autoMerge.result.notFound
        : undefined;

  return (
    <div className={styles.wrap}>
      <ToggleSwitch
        label={t.projects.action.autoMerge}
        checked={optimisticEnabled}
        busy={pending}
        onToggle={onToggle}
        ariaLabel={t.projects.autoMergeAria(optimisticEnabled)}
        error={error}
      />
      {state.kind === 'updated' ? (
        <span
          className={`${styles.result} ${styles.resultSuccess}`}
          role="status"
          aria-live="polite"
        >
          {state.enabled
            ? t.settings.autoMerge.result.enabled(row.slug, state.retriagedCount)
            : t.settings.autoMerge.result.disabled(row.slug)}
        </span>
      ) : null}
    </div>
  );
}
