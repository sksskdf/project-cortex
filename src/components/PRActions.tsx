'use client';

import { useOptimistic, useState, useTransition } from 'react';
import { ko as t } from '@/copy/ko';
import {
  closePRAction,
  mergePRAction,
  requestChangesAction,
  type PRCloseState,
  type PRMergeActionState,
  type PRRequestChangesState,
} from '@/actions/pr';
import type { MergeableState } from '@/lib/github';
import styles from './PRActions.module.css';

type Props = {
  viewId: string;
  canMerge: boolean;
  isMerged: boolean;
  // 위험 분류 (reason.tone alert/warn) PR 에서만 true. false 면 변경 요청
  // 버튼 자체를 렌더하지 않음 — Cortex 는 AI 코드의 게이트키퍼라 신뢰도 높은
  // PR 까지 사람의 거절 의사를 push 할 필요가 없음.
  canRequestChanges: boolean;
  // GitHub mergeable_state — 'dirty'(충돌) · 'blocked' 면 머지 버튼이 disabled
  // (이미 lib/pr 에서 canMerge 에 반영). UI 가 사유를 사용자에게 명시하기 위해 별도 prop.
  mergeableState: MergeableState | null;
  // CI 결과 대기 중이라 머지 버튼이 disable 됨 — preReview.testsPassed=null.
  mergeBlockedByCI: boolean;
};

type InFlightAction = 'merge' | 'request' | 'close' | null;

export function PRActions({
  viewId,
  canMerge,
  isMerged,
  canRequestChanges,
  mergeableState,
  mergeBlockedByCI,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [mergeState, setMergeState] = useState<PRMergeActionState>({ kind: 'idle' });
  const [requestState, setRequestState] = useState<PRRequestChangesState>({ kind: 'idle' });
  const [closeState, setCloseState] = useState<PRCloseState>({ kind: 'idle' });
  // 변경 요청 textarea 토글. 클릭 즉시 전송하지 않고 사유 입력을 받음.
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestBody, setRequestBody] = useState('');
  // PR 닫기 확인 패널 토글 — 'PR 닫기' 1차 클릭 → 확인 메시지 + 닫기/취소.
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [inFlight, setInFlight] = useState<InFlightAction>(null);
  // 머지 클릭 즉시 isMerged=true 가정 — server action 의 revalidatePath 가 도착하기
  // 전 잠깐의 stale window 회피. 실패 시 transition 종료 + revalidate 되며 자동 revert.
  const [optimisticMerged, setOptimisticMerged] = useOptimistic(
    isMerged,
    (_current, next: boolean) => next,
  );

  // 액션 시작 시 모든 result state 초기화 — 이전 액션의 결과 메시지 잔여물 제거.
  function resetAllStates() {
    setMergeState({ kind: 'idle' });
    setRequestState({ kind: 'idle' });
    setCloseState({ kind: 'idle' });
  }

  function runMerge() {
    resetAllStates();
    setInFlight('merge');
    startTransition(async () => {
      setOptimisticMerged(true);
      const next = await mergePRAction(viewId);
      setMergeState(next);
      setInFlight(null);
    });
  }

  function runRequestChanges() {
    resetAllStates();
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

  function runClose() {
    resetAllStates();
    setInFlight('close');
    startTransition(async () => {
      const next = await closePRAction(viewId);
      setCloseState(next);
      setInFlight(null);
      if (next.kind === 'closed') {
        setCloseConfirmOpen(false);
      }
    });
  }

  // 머지 = 브랜치 자동 삭제 (자동 머지 / 사람 머지 둘 다). 별도 '브랜치 삭제'
  // 버튼 흐름 제거. 머지된 후 PR 상세에서는 액션 영역에 안내만 노출.
  const isMergedView = optimisticMerged || mergeState.kind === 'merged';
  const mergeDisabled = !canMerge || pending || isMergedView;
  // GitHub mergeable_state 가 'dirty'/'blocked' 이거나 CI 결과 대기 중이면 머지 버튼이
  // disable 된 채로 사용자가 사유를 알 수 있도록 배지 노출.
  // 우선순위: dirty > blocked > CI 대기.
  const mergeBlockNote: string | null = mergeBlockedByCI
    ? t.pr.actionBar.mergeBlock.ciPending
    : mergeableState === 'dirty'
      ? t.pr.actionBar.mergeBlock.conflict
      : mergeableState === 'blocked'
        ? t.pr.actionBar.mergeBlock.blocked
        : null;
  // 위험 분류 PR 이 아니면 버튼을 렌더 안 함 (canRequestChanges=false).
  // 렌더하는 경우엔 pending/머지됨 외에는 항상 활성.
  const requestDisabled = pending || optimisticMerged;

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
        {isMergedView ? (
          // 머지 완료 — 브랜치 자동 삭제. 별도 액션 버튼 없음.
          <span
            className={`${styles.result} ${styles.resultSuccess}`}
            role="status"
            aria-live="polite"
          >
            {t.pr.actionBar.mergedWithBranchDeleted}
          </span>
        ) : (
          <>
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
            {mergeBlockNote && (
              <span
                className={`${styles.result} ${styles.resultError}`}
                role="status"
                aria-live="polite"
              >
                {mergeBlockNote}
              </span>
            )}
          </>
        )}
        {/* PR 닫기 (폐기) — 머지 안 하고 폐기할 PR 정리용. 머지 가능 상태 (= 아직 안
           머지) 일 때만 노출. 머지된 PR 은 closeable 아님. */}
        {!isMergedView && canMerge && (
          <button
            type="button"
            className="ds-btn ds-btn--md ds-btn--outlined-basic"
            onClick={() => setCloseConfirmOpen((v) => !v)}
            disabled={pending}
            aria-expanded={closeConfirmOpen}
          >
            <span className="ds-btn__label">{t.pr.actionBar.closePR}</span>
          </button>
        )}
        <PRActionResult
          mergeState={mergeState}
          requestState={requestState}
          closeState={closeState}
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
      {closeConfirmOpen && canMerge && (
        <div className={styles.requestPanel}>
          <div className={styles.closeConfirmText}>{t.pr.actionBar.closeConfirm}</div>
          <div className={styles.requestActions}>
            <button
              type="button"
              className="ds-btn ds-btn--md ds-btn--outlined-basic"
              onClick={() => setCloseConfirmOpen(false)}
              disabled={pending}
            >
              <span className="ds-btn__label">{t.pr.actionBar.requestCancel}</span>
            </button>
            <button
              type="button"
              className="ds-btn ds-btn--md ds-btn--filled-red"
              onClick={runClose}
              disabled={pending}
              aria-busy={inFlight === 'close'}
            >
              <span className="ds-btn__label">
                {inFlight === 'close' ? t.pr.actionBar.closing : t.pr.actionBar.closeConfirmSubmit}
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
  requestState,
  closeState,
}: {
  mergeState: PRMergeActionState;
  requestState: PRRequestChangesState;
  closeState: PRCloseState;
}) {
  if (closeState.kind === 'closed') {
    return (
      <div className={`${styles.result} ${styles.resultSuccess}`} role="status" aria-live="polite">
        {t.pr.actionBar.result.closed(closeState.number)}
      </div>
    );
  }
  if (closeState.kind === 'skipped' || closeState.kind === 'error') {
    return (
      <div className={`${styles.result} ${styles.resultError}`} role="alert">
        {t.pr.actionBar.result.closeError(closeState.message)}
      </div>
    );
  }
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
