'use client';

import { useState, useTransition } from 'react';
import { ko as t } from '@/copy/ko';
import { requestAnalysisAction, type PRAnalyzeState } from '@/actions/pr';
import styles from './PRActions.module.css';

type Props = {
  viewId: string;
  canRequestAnalysis: boolean;
  aiEnabled: boolean;
};

export function AnalyzeRequestButton({ viewId, canRequestAnalysis, aiEnabled }: Props) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<PRAnalyzeState>({ kind: 'idle' });

  function run() {
    setState({ kind: 'idle' });
    startTransition(async () => {
      const next = await requestAnalysisAction(viewId);
      setState(next);
    });
  }

  const disabled = !canRequestAnalysis || pending || state.kind === 'analyzed';
  const label = !aiEnabled
    ? t.pr.analyze.disabledByToggle
    : pending
      ? t.pr.analyze.pending
      : state.kind === 'analyzed'
        ? t.pr.analyze.done
        : t.pr.analyze.request;

  return (
    <div className={styles.row}>
      <button
        type="button"
        className="ds-btn ds-btn--md ds-btn--outlined-basic"
        onClick={run}
        disabled={disabled}
        aria-busy={pending}
        aria-disabled={disabled}
      >
        <span className="ds-btn__label">{label}</span>
      </button>
      <AnalyzeResult state={state} />
    </div>
  );
}

function AnalyzeResult({ state }: { state: PRAnalyzeState }) {
  if (state.kind === 'idle') return null;
  if (state.kind === 'analyzed') {
    return (
      <div className={`${styles.result} ${styles.resultSuccess}`} role="status" aria-live="polite">
        {t.pr.analyze.result.success}
      </div>
    );
  }
  if (state.kind === 'skipped') {
    return (
      <div className={`${styles.result} ${styles.resultError}`} role="alert">
        {state.message}
      </div>
    );
  }
  return (
    <div className={`${styles.result} ${styles.resultError}`} role="alert">
      {t.pr.analyze.result.error(state.message)}
    </div>
  );
}
