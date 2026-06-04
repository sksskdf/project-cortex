'use client';

// Phase 10.4 — Cortex UI 로드맵(DB)을 git `.cortex/roadmap.md` 로 PR 생성(수동 push 방향).
// 기존 RoadmapSyncButton(git → Cortex pull)의 반대 방향. roadmap.md 만 변경, PR 로 리뷰 가능.

import { useState, useTransition } from 'react';
import { ko as t } from '@/copy/ko';
import { pushRoadmapToGitAction, type PushRoadmapActionState } from '@/actions/project-meta';
import styles from './RoadmapSyncButton.module.css';

export function RoadmapPushButton({ projectId }: { projectId: number }) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<PushRoadmapActionState>({ kind: 'idle' });

  function onClick() {
    setState({ kind: 'idle' });
    startTransition(async () => {
      setState(await pushRoadmapToGitAction(projectId));
    });
  }

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className="ds-btn ds-btn--md ds-btn--outlined-basic"
        onClick={onClick}
        disabled={pending}
        aria-busy={pending}
      >
        <span className="ds-btn__label">
          {pending ? t.roadmap.push.pending : t.roadmap.push.button}
        </span>
      </button>
      <PushResult state={state} />
    </div>
  );
}

function PushResult({ state }: { state: PushRoadmapActionState }) {
  if (state.kind === 'idle') return null;
  if (state.kind === 'pushed') {
    return (
      <span className={`${styles.result} ${styles.resultSuccess}`} role="status" aria-live="polite">
        {t.roadmap.push.result.pushed(state.prNumber)}
      </span>
    );
  }
  if (state.kind === 'no-changes') {
    return (
      <span className={`${styles.result} ${styles.resultWarn}`} role="status" aria-live="polite">
        {t.roadmap.push.result.noChanges}
      </span>
    );
  }
  if (state.kind === 'no-installation') {
    return (
      <span className={`${styles.result} ${styles.resultError}`} role="alert">
        {t.roadmap.push.result.noInstallation}
      </span>
    );
  }
  if (state.kind === 'no-project') {
    return (
      <span className={`${styles.result} ${styles.resultError}`} role="alert">
        {t.roadmap.push.result.noProject}
      </span>
    );
  }
  const message = state.kind === 'failed' ? state.reason : state.message;
  return (
    <span className={`${styles.result} ${styles.resultError}`} role="alert">
      {t.roadmap.push.result.failed(message)}
    </span>
  );
}
