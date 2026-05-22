'use client';

// Phase 10.1 — .cortex/ 동기화 버튼. /projects/[id]/roadmap 헤더에 노출.

import { useState, useTransition } from 'react';
import { ko as t } from '@/copy/ko';
import { syncProjectMetaAction, type SyncActionState } from '@/actions/project-meta';
import styles from './RoadmapSyncButton.module.css';

export function RoadmapSyncButton({ projectId }: { projectId: number }) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<SyncActionState>({ kind: 'idle' });

  function onClick() {
    setState({ kind: 'idle' });
    startTransition(async () => {
      const r = await syncProjectMetaAction(projectId);
      setState(r);
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
          {pending ? t.roadmap.sync.pending : t.roadmap.sync.button}
        </span>
      </button>
      <SyncResult state={state} />
    </div>
  );
}

function SyncResult({ state }: { state: SyncActionState }) {
  if (state.kind === 'idle') return null;
  if (state.kind === 'synced') {
    return (
      <span className={`${styles.result} ${styles.resultSuccess}`} role="status" aria-live="polite">
        {t.roadmap.sync.result.synced(
          state.phasesAdded + state.phasesUpdated,
          state.itemsAdded + state.itemsUpdated,
        )}
      </span>
    );
  }
  if (state.kind === 'no-meta-file') {
    return (
      <span className={`${styles.result} ${styles.resultWarn}`} role="status" aria-live="polite">
        {t.roadmap.sync.result.noMetaFile}
      </span>
    );
  }
  if (state.kind === 'no-installation') {
    return (
      <span className={`${styles.result} ${styles.resultError}`} role="alert">
        {t.roadmap.sync.result.noInstallation}
      </span>
    );
  }
  if (state.kind === 'no-project') {
    return (
      <span className={`${styles.result} ${styles.resultError}`} role="alert">
        {t.roadmap.sync.result.noProject}
      </span>
    );
  }
  if (state.kind === 'meta-parse-error') {
    return (
      <span className={`${styles.result} ${styles.resultError}`} role="alert">
        {t.roadmap.sync.result.parseError(state.message)}
      </span>
    );
  }
  return (
    <span className={`${styles.result} ${styles.resultError}`} role="alert">
      {t.roadmap.sync.result.error(state.message)}
    </span>
  );
}
