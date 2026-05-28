'use client';

// 프로젝트 뮤트 토글. muted=true 면 webhook 무시(인박스/분석/자동머지 차단), /projects 엔 남음.
// 자동 onboard 로 새로 감지된 레포는 기본 muted — 여기서 '관리 시작' 으로 해제.

import { useOptimistic, useState, useTransition } from 'react';
import { ko as t } from '@/copy/ko';
import { toggleProjectMutedAction, type ProjectMuteActionState } from '@/actions/settings';
import styles from './ProjectAutoMergeToggle.module.css';

export function ProjectMuteToggle({ id, muted }: { id: number; muted: boolean }) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<ProjectMuteActionState>({ kind: 'idle' });
  const [optimisticMuted, setOptimisticMuted] = useOptimistic(
    muted,
    (_current, next: boolean) => next,
  );

  function onToggle() {
    const next = !optimisticMuted;
    setState({ kind: 'idle' });
    startTransition(async () => {
      setOptimisticMuted(next);
      setState(await toggleProjectMutedAction(id, next));
    });
  }

  // 뮤트 상태면 '관리 시작'(채워진 버튼, 권유), 활성 상태면 '뮤트'(외곽선, 부가).
  return (
    <div className={styles.wrap}>
      <button
        type="button"
        role="switch"
        aria-checked={!optimisticMuted}
        aria-busy={pending}
        disabled={pending}
        onClick={onToggle}
        aria-label={t.projects.muteAria(optimisticMuted)}
        title={t.projects.muteAria(optimisticMuted)}
        className={`ds-btn ds-btn--md ${optimisticMuted ? 'ds-btn--filled-blue' : 'ds-btn--outlined-basic'}`}
      >
        <span className="ds-btn__label">
          {optimisticMuted ? t.projects.action.manage : t.projects.action.mute}
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
