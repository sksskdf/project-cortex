'use client';

// 프로젝트별 브랜치 자동 삭제 토글. 디폴트 OFF — 자동/클러스터 머지 후 head 브랜치 삭제 여부.
// (수동 'PR 상세 브랜치 삭제' 버튼은 명시적 액션이라 이 토글과 무관하게 동작.)

import { useOptimistic, useState, useTransition } from 'react';
import { ko as t } from '@/copy/ko';
import {
  toggleProjectAutoDeleteBranchAction,
  type ProjectBranchDeleteActionState,
} from '@/actions/settings';
import styles from './ProjectAutoMergeToggle.module.css';

export function ProjectBranchDeleteToggle({ id, enabled }: { id: number; enabled: boolean }) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<ProjectBranchDeleteActionState>({ kind: 'idle' });
  const [optimisticEnabled, setOptimisticEnabled] = useOptimistic(
    enabled,
    (_current, next: boolean) => next,
  );

  function onToggle() {
    const next = !optimisticEnabled;
    setState({ kind: 'idle' });
    startTransition(async () => {
      setOptimisticEnabled(next);
      setState(await toggleProjectAutoDeleteBranchAction(id, next));
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
        aria-label={t.projects.branchDeleteAria(optimisticEnabled)}
        title={t.projects.branchDeleteAria(optimisticEnabled)}
        className={`ds-btn ds-btn--md ${optimisticEnabled ? 'ds-btn--filled-blue' : 'ds-btn--outlined-basic'}`}
      >
        <span className="ds-btn__label">
          {t.projects.action.branchDelete}{' '}
          {optimisticEnabled ? t.settings.ai.on : t.settings.ai.off}
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
