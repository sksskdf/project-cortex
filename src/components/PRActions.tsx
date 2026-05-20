'use client';

import { useState, useTransition } from 'react';
import { ko as t } from '@/copy/ko';
import { mergePRAction, type PRMergeActionState } from '@/actions/pr';
import styles from './PRActions.module.css';

type Props = {
  viewId: string;
  canMerge: boolean;
};

export function PRActions({ viewId, canMerge }: Props) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<PRMergeActionState>({ kind: 'idle' });

  function runMerge() {
    setState({ kind: 'idle' });
    startTransition(async () => {
      const next = await mergePRAction(viewId);
      setState(next);
    });
  }

  const mergeDisabled = !canMerge || pending || state.kind === 'merged';

  return (
    <div className={styles.row}>
      {/* 변경 요청 · 자동 승인 가능 항목만 머지 — GitHub Reviews API / hunk 선택 흐름 미구현. */}
      <button
        type="button"
        className="ds-btn ds-btn--md ds-btn--outlined-red"
        disabled
        aria-disabled="true"
      >
        <span className="ds-btn__label">{t.pr.actionBar.requestChanges}</span>
      </button>
      <button
        type="button"
        className="ds-btn ds-btn--md ds-btn--outlined-basic"
        disabled
        aria-disabled="true"
      >
        <span className="ds-btn__label">{t.pr.actionBar.autoApprove}</span>
      </button>
      <button
        type="button"
        className="ds-btn ds-btn--md ds-btn--filled-blue"
        onClick={runMerge}
        disabled={mergeDisabled}
        aria-busy={pending}
      >
        <span className="ds-btn__label">
          {pending ? t.pr.actionBar.merging : t.pr.actionBar.mergeAll}
        </span>
      </button>
      <PRActionResult state={state} />
    </div>
  );
}

function PRActionResult({ state }: { state: PRMergeActionState }) {
  if (state.kind === 'idle') return null;
  if (state.kind === 'merged') {
    return (
      <div className={`${styles.result} ${styles.resultSuccess}`} role="status" aria-live="polite">
        {t.pr.actionBar.result.merged(state.sha.slice(0, 7))}
      </div>
    );
  }
  return (
    <div className={`${styles.result} ${styles.resultError}`} role="alert">
      {t.pr.actionBar.result.error(state.message)}
    </div>
  );
}
