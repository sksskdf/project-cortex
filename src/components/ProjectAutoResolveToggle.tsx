'use client';

// 프로젝트별 머지 충돌 자동 해결 토글 (Phase 13.2). 디폴트 OFF — 켜면 자동 머지 중 dirty
// 충돌이 나도 claude CLI 가 워크스페이스에서 마커를 해소하고 push 한다. 신뢰가 선행돼야 하므로
// 명시적으로 켤 때만 발화.

import { useOptimistic, useState, useTransition } from 'react';
import { ko as t } from '@/copy/ko';
import {
  toggleProjectAutoResolveConflictsAction,
  type ProjectAutoResolveActionState,
} from '@/actions/settings';
import styles from './ProjectAutoMergeToggle.module.css';

export function ProjectAutoResolveToggle({ id, enabled }: { id: number; enabled: boolean }) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<ProjectAutoResolveActionState>({ kind: 'idle' });
  const [optimisticEnabled, setOptimisticEnabled] = useOptimistic(
    enabled,
    (_current, next: boolean) => next,
  );

  function onToggle() {
    const next = !optimisticEnabled;
    setState({ kind: 'idle' });
    startTransition(async () => {
      setOptimisticEnabled(next);
      setState(await toggleProjectAutoResolveConflictsAction(id, next));
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
        aria-label={t.projects.autoResolveAria(optimisticEnabled)}
        title={t.projects.autoResolveAria(optimisticEnabled)}
        className={`ds-btn ds-btn--md ${optimisticEnabled ? 'ds-btn--filled-blue' : 'ds-btn--outlined-basic'}`}
      >
        <span className="ds-btn__label">
          {t.projects.action.autoResolve} {optimisticEnabled ? t.settings.ai.on : t.settings.ai.off}
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
