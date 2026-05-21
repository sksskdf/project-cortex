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
  // 위험 분류 (reason.tone alert/warn) PR 에서만 true. false 면 변경 요청
  // 버튼 자체를 렌더하지 않음 — Cortex 는 AI 코드의 게이트키퍼라 신뢰도 높은
  // PR 까지 사람의 거절 의사를 push 할 필요가 없음.
  canRequestChanges: boolean;
};

type InFlightAction = 'merge' | 'delete' | 'request' | null;

export function PRActions({ viewId, canMerge, isMerged, branchDeleted, canRequestChanges }: Props) {
  const [pending, startTransition] = useTransition();
  const [mergeState, setMergeState] = useState<PRMergeActionState>({ kind: 'idle' });
  const [branchState, setBranchState] = useState<PRBranchDeleteState>({ kind: 'idle' });
  const [requestState, setRequestState] = useState<PRRequestChangesState>({ kind: 'idle' });
  // 변경 요청 textarea 토글. 클릭 즉시 전송하지 않고 사유 입력을 받음.
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestBody, setRequestBody] = useState('');
  // useTransition 의 pending 은 어떤 액션이 in-flight 인지 구분 못 함 — 머지 직후
  // showDeleteBranch=true 가 되는데 pending 도 true 라 delete 버튼이 "삭제 중..." 으로
  // 잘못 표시되는 버그가 있었음. 어떤 액션인지 별도 추적해 라벨이 섞이지 않게.
  const [inFlight, setInFlight] = useState<InFlightAction>(null);

  function runMerge() {
    setMergeState({ kind: 'idle' });
    setBranchState({ kind: 'idle' });
    setInFlight('merge');
    startTransition(async () => {
      const next = await mergePRAction(viewId);
      setMergeState(next);
      setInFlight(null);
    });
  }

  function runDeleteBranch() {
    setBranchState({ kind: 'idle' });
    setInFlight('delete');
    startTransition(async () => {
      const next = await deletePRBranchAction(viewId);
      setBranchState(next);
      setInFlight(null);
    });
  }

  function runRequestChanges() {
    setRequestState({ kind: 'idle' });
    setInFlight('request');
    startTransition(async () => {
      const next = await requestChangesAction(viewId, requestBody);
      setRequestState(next);
      setInFlight(null);
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
  // 위험 분류 PR 이 아니면 버튼을 렌더 안 함 (canRequestChanges=false).
  // 렌더하는 경우엔 pending/머지됨 외에는 항상 활성.
  const requestDisabled = pending || isMerged;

  return (
    <div className={styles.column}>
      <div className={styles.row}>
        {canRequestChanges && (
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
        )}
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
            aria-busy={inFlight === 'delete'}
            aria-disabled={branchDeleted}
          >
            <span className="ds-btn__label">
              {branchDeleted
                ? t.pr.actionBar.branchAlreadyDeleted
                : inFlight === 'delete'
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
            aria-busy={inFlight === 'merge'}
          >
            <span className="ds-btn__label">
              {inFlight === 'merge' ? t.pr.actionBar.merging : t.pr.actionBar.mergeAll}
            </span>
          </button>
        )}
        <PRActionResult
          mergeState={mergeState}
          branchState={branchState}
          requestState={requestState}
        />
      </div>
      {canRequestChanges && requestOpen && (
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
              aria-busy={inFlight === 'request'}
            >
              <span className="ds-btn__label">
                {inFlight === 'request'
                  ? t.pr.actionBar.requestSending
                  : t.pr.actionBar.requestSubmit}
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
