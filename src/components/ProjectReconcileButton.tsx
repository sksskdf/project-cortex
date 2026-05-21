'use client';

// /settings 의 자동 머지 토글 행 옆에 노출되는 'GitHub 와 동기화' 버튼.
// 사용자가 누르면 reconcileProject 가 octokit.pulls.list 로 open PR 전체 fetch +
// handlePullRequestWebhook (source='reconcile') 로 upsert. AI 분석 명시 bypass —
// 크레딧 0.

import { useState, useTransition } from 'react';
import { ko as t } from '@/copy/ko';
import { reconcileProjectAction, type ReconcileActionState } from '@/actions/settings';
import styles from '@/app/settings/page.module.css';

export function ProjectReconcileButton({ projectId }: { projectId: number }) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<ReconcileActionState>({ kind: 'idle' });

  function onClick() {
    setState({ kind: 'idle' });
    startTransition(async () => {
      const result = await reconcileProjectAction(projectId);
      setState(result);
    });
  }

  return (
    <>
      <button
        type="button"
        className="ds-btn ds-btn--md ds-btn--outlined-basic"
        onClick={onClick}
        disabled={pending}
        aria-busy={pending}
      >
        <span className="ds-btn__label">
          {pending ? t.settings.reconcile.pending : t.settings.reconcile.button}
        </span>
      </button>
      <ReconcileResult state={state} />
    </>
  );
}

function ReconcileResult({ state }: { state: ReconcileActionState }) {
  if (state.kind === 'idle') return null;
  if (state.kind === 'reconciled') {
    return (
      <span className={`${styles.result} ${styles.resultSuccess}`} role="status" aria-live="polite">
        {t.settings.reconcile.result.reconciled(
          state.slug,
          state.total,
          state.inserted,
          state.updated,
        )}
      </span>
    );
  }
  if (state.kind === 'skipped') {
    return (
      <span className={`${styles.result} ${styles.resultError}`} role="alert">
        {state.message}
      </span>
    );
  }
  return (
    <span className={`${styles.result} ${styles.resultError}`} role="alert">
      {t.settings.reconcile.result.error(state.message)}
    </span>
  );
}
