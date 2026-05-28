'use client';

// Phase 13.4 — 이슈 위임 '완료 처리' 버튼. 대화형 세션은 사용자가 안 닫으면 agent_run 이
// running 에 고정 → 이슈 미완료 + 대시보드 '진행 중' 잔류. 이 버튼이 강제 완료한다.
// 되돌리기 UI 가 없어 실수 클릭 방지로 인라인 확인 단계를 둔다.

import { useState, useTransition } from 'react';
import { ko as t } from '@/copy/ko';
import { completeIssueDelegationAction } from '@/actions/issues';
import styles from './IssueCompleteButton.module.css';

const c = t.issues.detail.complete;

export function IssueCompleteButton({ issueId }: { issueId: number }) {
  const [confirm, setConfirm] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(false);

  function onConfirm() {
    setConfirm(false);
    setError(false);
    startTransition(async () => {
      const r = await completeIssueDelegationAction(issueId);
      if (r.kind === 'error') setError(true);
    });
  }

  if (confirm) {
    return (
      <span className={styles.confirm}>
        <span className={styles.confirmText}>{c.confirm}</span>
        <button
          type="button"
          className="ds-btn ds-btn--sm ds-btn--filled-blue"
          onClick={onConfirm}
          disabled={pending}
        >
          <span className="ds-btn__label">{c.confirmYes}</span>
        </button>
        <button
          type="button"
          className="ds-btn ds-btn--sm ds-btn--outlined-basic"
          onClick={() => setConfirm(false)}
          disabled={pending}
        >
          <span className="ds-btn__label">{c.confirmNo}</span>
        </button>
      </span>
    );
  }

  return (
    <span className={styles.wrap}>
      <button
        type="button"
        className="ds-btn ds-btn--sm ds-btn--outlined-basic"
        onClick={() => setConfirm(true)}
        disabled={pending}
        aria-busy={pending}
      >
        <span className="ds-btn__label">{pending ? c.pending : c.button}</span>
      </button>
      {error ? <span className={styles.error}>{c.error}</span> : null}
    </span>
  );
}
