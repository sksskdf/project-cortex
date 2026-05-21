'use client';

import { useState, useTransition } from 'react';
import { ko as t } from '@/copy/ko';
import {
  deletePRBranchAction,
  mergePRAction,
  requestChangesAction,
  type PRBranchDeleteState,
  type PRMergeActionState,
  type PRRequestChangesState,
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
  const [requestState, setRequestState] = useState<PRRequestChangesState>({ kind: 'idle' });
  // 변경 요청 textarea 토글. 클릭 즉시 전송하지 않고 사유 입력을 받음.
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestBody, setRequestBody] = useState('');

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

  function runRequestChanges() {
    setRequestState({ kind: 'idle' });
    startTransition(async () => {
      const next = await requestChangesAction(viewId, requestBody);
      setRequestState(next);
      if (next.kind === 'submitted') {
        setRequestOpen(false);
        setRequestBody('');
      }
    });
  }

  // 머지 직후엔 revalidatePath 로 page 가 새로 fetch 되면서 isMerged 가 true 가 됨.
  // 그동안의 transient 상태 표시는 mergeState.kind === 'merged' 로 처리.
  const showDeleteBranch = isMerged || mergeState.kind === 'merged';
  const mergeDisabled = !canMerge || pending || showDeleteBranch;
  // 변경 요청은 GitHub 머지 못 하는 PR (시드) 도 의미 있을 수 있지만, 현 흐름은
  // installation 있을 때만 — canMerge 와 같은 조건 재사용.
  const requestDisabled = !canMerge || pending || isMerged;

  return (
    <div className={styles.column}>
      <div className={styles.row}>
        <button
          type="button"
          className="ds-btn ds-btn--md ds-btn--outlined-red"
          onClick={() => setRequestOpen((v) => !v)}
          disabled={requestDisabled}
          aria-disabled={requestDisabled}
          aria-expanded={requestOpen}
        >
          <span className="ds-btn__label">{t.pr.actionBar.requestChanges}</span>
        </button>
        {/* 자동 승인 가능 항목만 머지 — hunk 선택 흐름 미구현. */}
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
        <PRActionResult
          mergeState={mergeState}
          branchState={branchState}
          requestState={requestState}
        />
      </div>
      {requestOpen && (
        <div className={styles.requestPanel}>
          <textarea
            className={styles.requestTextarea}
            placeholder={t.pr.actionBar.requestPlaceholder}
            value={requestBody}
            onChange={(e) => setRequestBody(e.target.value)}
            disabled={pending}
            rows={3}
          />
          <div className={styles.requestActions}>
            <button
              type="button"
              className="ds-btn ds-btn--md ds-btn--outlined-basic"
              onClick={() => setRequestOpen(false)}
              disabled={pending}
            >
              <span className="ds-btn__label">{t.pr.actionBar.requestCancel}</span>
            </button>
            <button
              type="button"
              className="ds-btn ds-btn--md ds-btn--filled-red"
              onClick={runRequestChanges}
              disabled={pending}
              aria-busy={pending}
            >
              <span className="ds-btn__label">
                {pending ? t.pr.actionBar.requestSending : t.pr.actionBar.requestSubmit}
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PRActionResult({
  mergeState,
  branchState,
  requestState,
}: {
  mergeState: PRMergeActionState;
  branchState: PRBranchDeleteState;
  requestState: PRRequestChangesState;
}) {
  if (requestState.kind === 'submitted') {
    return (
      <div className={`${styles.result} ${styles.resultSuccess}`} role="status" aria-live="polite">
        {t.pr.actionBar.result.requestSubmitted}
      </div>
    );
  }
  if (requestState.kind === 'skipped' || requestState.kind === 'error') {
    return (
      <div className={`${styles.result} ${styles.resultError}`} role="alert">
        {t.pr.actionBar.result.requestError(requestState.message)}
      </div>
    );
  }

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
