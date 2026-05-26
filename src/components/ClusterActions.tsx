'use client';

import { useState, useTransition } from 'react';
import { ko as t } from '@/copy/ko';
import {
  dissolveClusterAction,
  mergeClusterAction,
  type ClusterActionState,
} from '@/actions/cluster';
import type { ClusterRow } from '@/db/schema';
import styles from './ClusterActions.module.css';

type Props = {
  viewId: string;
  totalCount: number;
  status: ClusterRow['status'];
};

// 머지/해제가 의미 있는 상태 — 'open' 또는 'partially-merged' (일부 PR 만 머지).
// merged/dissolved 면 닫힌 클러스터라 모든 액션 disable.
function isActiveStatus(status: ClusterRow['status']): boolean {
  return status === 'open' || status === 'partially-merged';
}

export function ClusterActions({ viewId, totalCount, status }: Props) {
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

  // 닫힌 클러스터(merged/dissolved) 또는 액션 진행 중이면 모든 머지/해제 disable.
  // 액션 직후 revalidatePath 가 페이지를 새로 그리지만, 그 사이에도 중복 트리거 방지.
  const closed = !isActiveStatus(status);
  const blocked = closed || pending || state.kind === 'merged' || state.kind === 'dissolved';

  return (
    <>
      <button
        type="button"
        className="ds-btn ds-btn--lg ds-btn--filled-blue ds-btn--full-width"
        onClick={runMerge}
        disabled={blocked}
        aria-busy={pending}
        aria-disabled={blocked}
      >
        <span className="ds-btn__label">
          {pending ? t.cluster.action.pending : t.cluster.action.mergeAll(totalCount)}
        </span>
      </button>
      <div className={styles.divider} aria-hidden="true" />
      <button
        type="button"
        className="ds-btn ds-btn--md ds-btn--filled-gray ds-btn--full-width"
        onClick={runDissolve}
        disabled={blocked}
        aria-busy={pending}
        aria-disabled={blocked}
      >
        <span className="ds-btn__label">
          {pending ? t.cluster.action.pending : t.cluster.action.dissolve}
        </span>
      </button>
      <ClusterActionResult state={state} closed={closed} />
    </>
  );
}

function ClusterActionResult({ state, closed }: { state: ClusterActionState; closed: boolean }) {
  if (state.kind === 'idle') {
    // 액션 결과는 없지만 이미 닫힌 클러스터면 상태 안내.
    if (closed) {
      return (
        <div className={`${styles.result} ${styles.resultPartial}`} role="note">
          {t.cluster.action.result.closed}
        </div>
      );
    }
    return null;
  }

  if (state.kind === 'merged') {
    const { merged, failed, skipped, total, branches } = state.result;
    const allMerged = merged === total && total > 0;
    const branchMessage = t.cluster.action.result.branches(
      branches.deleted,
      branches.skipped,
      branches.failed,
    );
    return (
      <div
        className={`${styles.result} ${allMerged ? styles.resultSuccess : styles.resultPartial}`}
        role="status"
        aria-live="polite"
      >
        {allMerged
          ? t.cluster.action.result.allMerged(merged)
          : t.cluster.action.result.partial(merged, failed, skipped, total)}
        {branchMessage ? ` ${branchMessage}` : ''}
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
