'use client';

// 프로젝트별 AI 사전 리뷰 토글. 디폴트 ON — 전역 settings.aiEnabled 와 AND 로 적용.
// 회사 레포 등 분석을 끄고 싶은 프로젝트만 개별 OFF.

import { useOptimistic, useState, useTransition } from 'react';
import { ko as t } from '@/copy/ko';
import { toggleProjectAiReviewAction, type ProjectAiReviewActionState } from '@/actions/settings';
import styles from './ProjectAutoMergeToggle.module.css';

export function ProjectAiReviewToggle({ id, enabled }: { id: number; enabled: boolean }) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<ProjectAiReviewActionState>({ kind: 'idle' });
  const [optimisticEnabled, setOptimisticEnabled] = useOptimistic(
    enabled,
    (_current, next: boolean) => next,
  );

  function onToggle() {
    const next = !optimisticEnabled;
    setState({ kind: 'idle' });
    startTransition(async () => {
      setOptimisticEnabled(next);
      setState(await toggleProjectAiReviewAction(id, next));
    });
  }

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        role="switch"
        aria-checked={optimisticEnabled}
        aria-busy={pending}
        disabled={pending}
        onClick={onToggle}
        aria-label={t.projects.aiReviewAria(optimisticEnabled)}
        title={t.projects.aiReviewAria(optimisticEnabled)}
        className={`ds-btn ds-btn--md ${optimisticEnabled ? 'ds-btn--filled-blue' : 'ds-btn--outlined-basic'}`}
      >
        <span className="ds-btn__label">
          {t.projects.action.aiReview} {optimisticEnabled ? t.settings.ai.on : t.settings.ai.off}
        </span>
      </button>
      {state.kind === 'error' ? (
        <span className={`${styles.result} ${styles.resultError}`} role="alert">
          {t.settings.autoMerge.result.error(state.message)}
        </span>
      ) : null}
    </div>
  );
}
