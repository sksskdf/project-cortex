'use client';

import { useState, useTransition } from 'react';
import { ko as t } from '@/copy/ko';
import {
  dissolveClusterAction,
  mergeClusterAction,
  type ClusterActionState,
} from '@/actions/cluster';
import styles from './ClusterActions.module.css';

type Props = {
  viewId: string;
  totalCount: number;
  identicalCount: number;
  individualReviewNumber: number;
};

export function ClusterActions({
  viewId,
  totalCount,
  identicalCount,
  individualReviewNumber,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<ClusterActionState>({ kind: 'idle' });

  function runMerge() {
    setState({ kind: 'idle' });
    startTransition(async () => {
      const next = await mergeClusterAction(viewId);
      setState(next);
    });
  }

  function runDissolve() {
    setState({ kind: 'idle' });
    startTransition(async () => {
      const next = await dissolveClusterAction(viewId);
      setState(next);
    });
  }

  return (
    <>
      <button
        type="button"
        className="ds-btn ds-btn--lg ds-btn--filled-blue ds-btn--full-width"
        onClick={runMerge}
        disabled={pending}
        aria-busy={pending}
      >
        <span className="ds-btn__label">
          {pending ? t.cluster.action.pending : t.cluster.action.mergeAll(totalCount)}
        </span>
      </button>
      <button
        type="button"
        className="ds-btn ds-btn--md ds-btn--outlined-basic ds-btn--full-width"
        disabled={pending}
      >
        <span className="ds-btn__label">
          {t.cluster.action.splitMerge(identicalCount, individualReviewNumber)}
        </span>
      </button>
      <div className={styles.divider} aria-hidden="true" />
      <button
        type="button"
        className="ds-btn ds-btn--md ds-btn--outlined-basic ds-btn--full-width"
        disabled={pending}
      >
        <span className="ds-btn__label">{t.cluster.action.switchIndividual}</span>
      </button>
      <button
        type="button"
        className="ds-btn ds-btn--md ds-btn--filled-gray ds-btn--full-width"
        onClick={runDissolve}
        disabled={pending}
        aria-busy={pending}
      >
        <span className="ds-btn__label">
          {pending ? t.cluster.action.pending : t.cluster.action.dissolve}
        </span>
      </button>
      <ClusterActionResult state={state} />
    </>
  );
}

function ClusterActionResult({ state }: { state: ClusterActionState }) {
  if (state.kind === 'idle') return null;

  if (state.kind === 'merged') {
    const { merged, failed, skipped, total } = state.result;
    const allMerged = merged === total && total > 0;
    return (
      <div
        className={`${styles.result} ${allMerged ? styles.resultSuccess : styles.resultPartial}`}
        role="status"
        aria-live="polite"
      >
        {allMerged
          ? t.cluster.action.result.allMerged(merged)
          : t.cluster.action.result.partial(merged, failed, skipped, total)}
      </div>
    );
  }

  if (state.kind === 'dissolved') {
    return (
      <div className={`${styles.result} ${styles.resultSuccess}`} role="status" aria-live="polite">
        {t.cluster.action.result.dissolved(state.released)}
      </div>
    );
  }

  return (
    <div className={`${styles.result} ${styles.resultError}`} role="alert">
      {t.cluster.action.result.error(state.message)}
    </div>
  );
}
