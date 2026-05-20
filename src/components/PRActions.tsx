'use client';

import { useState, useTransition } from 'react';
import { ko as t } from '@/copy/ko';
import {
  deletePRBranchAction,
  mergePRAction,
  type PRBranchDeleteState,
  type PRMergeActionState,
} from '@/actions/pr';
import styles from './PRActions.module.css';

type Props = {
  viewId: string;
  canMerge: boolean;
  isMerged: boolean;
  // 서버에서 받은 영속 상태 — head 브랜치가 이미 삭제된 경우 버튼 비활성화.
  branchDeleted: boolean;
};

export function PRActions({ viewId, canMerge, isMerged, branchDeleted }: Props) {
  const [pending, startTransition] = useTransition();
  const [mergeState, setMergeState] = useState<PRMergeActionState>({ kind: 'idle' });
  const [branchState, setBranchState] = useState<PRBranchDeleteState>({ kind: 'idle' });

  function runMerge() {
    setMergeState({ kind: 'idle' });
    setBranchState({ kind: 'idle' });
    startTransition(async () => {
      const next = await mergePRAction(viewId);
      setMergeState(next);
    });
  }

  function runDeleteBranch() {
    setBranchState({ kind: 'idle' });
    startTransition(async () => {
      const next = await deletePRBranchAction(viewId);
      setBranchState(next);
    });
  }

  // 머지 직후엔 revalidatePath 로 page 가 새로 fetch 되면서 isMerged 가 true 가 됨.
  // 그동안의 transient 상태 표시는 mergeState.kind === 'merged' 로 처리.
  const showDeleteBranch = isMerged || mergeState.kind === 'merged';
  const mergeDisabled = !canMerge || pending || showDeleteBranch;

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
      {showDeleteBranch ? (
        <button
          type="button"
          className="ds-btn ds-btn--md ds-btn--outlined-basic"
          onClick={runDeleteBranch}
          disabled={branchDeleted || pending || branchState.kind === 'deleted'}
          aria-busy={pending}
          aria-disabled={branchDeleted}
        >
          <span className="ds-btn__label">
            {branchDeleted
              ? t.pr.actionBar.branchAlreadyDeleted
              : pending
                ? t.pr.actionBar.deletingBranch
                : t.pr.actionBar.deleteBranch}
          </span>
        </button>
      ) : (
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
      )}
      <PRActionResult mergeState={mergeState} branchState={branchState} />
    </div>
  );
}

function PRActionResult({
  mergeState,
  branchState,
}: {
  mergeState: PRMergeActionState;
  branchState: PRBranchDeleteState;
}) {
  // 브랜치 삭제 결과가 있으면 그게 우선 (가장 최근 액션).
  if (branchState.kind === 'deleted') {
    return (
      <div className={`${styles.result} ${styles.resultSuccess}`} role="status" aria-live="polite">
        {t.pr.actionBar.result.branchDeleted(branchState.ref)}
      </div>
    );
  }
  if (branchState.kind === 'skipped') {
    return (
      <div className={`${styles.result} ${styles.resultError}`} role="alert">
        {t.pr.actionBar.result.branchSkipped(branchState.message)}
      </div>
    );
  }
  if (branchState.kind === 'error') {
    return (
      <div className={`${styles.result} ${styles.resultError}`} role="alert">
        {t.pr.actionBar.result.branchError(branchState.message)}
      </div>
    );
  }

  if (mergeState.kind === 'merged') {
    return (
      <div className={`${styles.result} ${styles.resultSuccess}`} role="status" aria-live="polite">
        {t.pr.actionBar.result.merged(mergeState.sha.slice(0, 7))}
      </div>
    );
  }
  if (mergeState.kind === 'error') {
    return (
      <div className={`${styles.result} ${styles.resultError}`} role="alert">
        {t.pr.actionBar.result.error(mergeState.message)}
      </div>
    );
  }
  return null;
}
