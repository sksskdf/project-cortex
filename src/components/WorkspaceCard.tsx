'use client';

// Phase 12 — 프로젝트 카드의 워크스페이스 등록 + git pull 영역.
// 미등록 상태: 경로 입력 form.
// 등록 상태: 경로 + git pull 버튼 + 마지막 결과.

import { useState, useTransition } from 'react';
import { ko as t } from '@/copy/ko';
import {
  deleteWorkspaceAction,
  pullWorkspaceAction,
  registerWorkspaceAction,
  type PullActionState,
  type WorkspaceActionState,
} from '@/actions/workspace';
import type { WorkspaceView } from '@/lib/workspace';
import styles from './WorkspaceCard.module.css';

function formatAge(d: Date | null): string {
  if (!d) return '—';
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  return `${Math.floor(hr / 24)}일 전`;
}

export function WorkspaceCard({
  projectId,
  workspace,
}: {
  projectId: number;
  workspace: WorkspaceView | null;
}) {
  if (!workspace) {
    return <RegisterForm projectId={projectId} />;
  }
  return <RegisteredView projectId={projectId} workspace={workspace} />;
}

function RegisterForm({ projectId }: { projectId: number }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [path, setPath] = useState('');
  const [state, setState] = useState<WorkspaceActionState>({ kind: 'idle' });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState({ kind: 'idle' });
    startTransition(async () => {
      const r = await registerWorkspaceAction({ projectId, localPath: path });
      setState(r);
      if (r.kind === 'registered' || r.kind === 'updated') {
        setPath('');
        setOpen(false);
      }
    });
  }

  if (!open) {
    return (
      <div className={styles.notRegistered}>
        <div className={styles.notRegisteredText}>
          <strong>{t.workspace.notRegistered}</strong>
          <p>{t.workspace.notRegisteredDesc}</p>
        </div>
        <button
          type="button"
          className="ds-btn ds-btn--sm ds-btn--outlined-basic"
          onClick={() => setOpen(true)}
        >
          <span className="ds-btn__label">{t.workspace.register}</span>
        </button>
      </div>
    );
  }

  return (
    <form className={styles.form} onSubmit={onSubmit}>
      <label className={styles.label}>
        {t.workspace.pathLabel}
        <input
          type="text"
          className={styles.input}
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder={t.workspace.pathPlaceholder}
          disabled={pending}
          required
        />
      </label>
      <ResultMessage state={state} />
      <div className={styles.formActions}>
        <button
          type="button"
          className="ds-btn ds-btn--sm ds-btn--outlined-basic"
          onClick={() => setOpen(false)}
          disabled={pending}
        >
          <span className="ds-btn__label">{t.workspace.cancel}</span>
        </button>
        <button
          type="submit"
          className="ds-btn ds-btn--sm ds-btn--filled-blue"
          disabled={pending}
          aria-busy={pending}
        >
          <span className="ds-btn__label">{t.workspace.submit}</span>
        </button>
      </div>
    </form>
  );
}

function RegisteredView({ projectId, workspace }: { projectId: number; workspace: WorkspaceView }) {
  const [pending, startTransition] = useTransition();
  const [pullState, setPullState] = useState<PullActionState>({ kind: 'idle' });
  const [confirmRemove, setConfirmRemove] = useState(false);

  function onPull() {
    setPullState({ kind: 'idle' });
    startTransition(async () => {
      const r = await pullWorkspaceAction(projectId);
      setPullState(r);
    });
  }

  function onConfirmRemove() {
    setConfirmRemove(false);
    startTransition(async () => {
      await deleteWorkspaceAction({ projectId, workspaceId: workspace.id });
    });
  }

  return (
    <div className={styles.registered}>
      <div className={styles.registeredHead}>
        <code className={styles.path}>{workspace.localPath}</code>
        <button
          type="button"
          className={styles.removeBtn}
          onClick={() => setConfirmRemove(true)}
          disabled={pending || confirmRemove}
          title={t.workspace.remove}
        >
          ×
        </button>
      </div>
      {confirmRemove && (
        <div className={styles.confirmPanel} role="alertdialog">
          <span className={styles.confirmText}>
            {t.workspace.removeConfirm(workspace.localPath)}
          </span>
          <div className={styles.confirmActions}>
            <button
              type="button"
              className="ds-btn ds-btn--sm ds-btn--outlined-basic"
              onClick={() => setConfirmRemove(false)}
              disabled={pending}
            >
              <span className="ds-btn__label">{t.workspace.removeConfirmNo}</span>
            </button>
            <button
              type="button"
              className="ds-btn ds-btn--sm ds-btn--filled-red"
              onClick={onConfirmRemove}
              disabled={pending}
            >
              <span className="ds-btn__label">{t.workspace.removeConfirmYes}</span>
            </button>
          </div>
        </div>
      )}
      <div className={styles.actions}>
        <button
          type="button"
          className="ds-btn ds-btn--sm ds-btn--filled-blue"
          onClick={onPull}
          disabled={pending}
          aria-busy={pending && pullState.kind === 'idle'}
        >
          <span className="ds-btn__label">
            {pending ? t.workspace.pullPending : t.workspace.pullButton}
          </span>
        </button>
        {workspace.lastPullAt && (
          <span className={styles.lastPull}>
            {t.workspace.lastPull(formatAge(workspace.lastPullAt))}
          </span>
        )}
      </div>
      <PullResultMessage state={pullState} fallback={workspace.lastPullResult} />
    </div>
  );
}

function ResultMessage({ state }: { state: WorkspaceActionState }) {
  if (state.kind === 'idle') return null;
  if (state.kind === 'registered' || state.kind === 'updated') {
    return (
      <span className={`${styles.result} ${styles.resultSuccess}`}>
        {state.kind === 'registered' ? t.workspace.result.registered : t.workspace.result.updated}
      </span>
    );
  }
  if (state.kind === 'invalid-path') {
    return (
      <span className={`${styles.result} ${styles.resultError}`}>
        {t.workspace.result.invalidPath(state.reason)}
      </span>
    );
  }
  if (state.kind === 'no-project') {
    return (
      <span className={`${styles.result} ${styles.resultError}`}>
        {t.workspace.result.noProject}
      </span>
    );
  }
  if (state.kind === 'deleted') {
    return (
      <span className={`${styles.result} ${styles.resultSuccess}`}>
        {t.workspace.result.deleted}
      </span>
    );
  }
  if (state.kind === 'not-found') {
    return (
      <span className={`${styles.result} ${styles.resultError}`}>
        {t.workspace.result.noWorkspace}
      </span>
    );
  }
  return (
    <span className={`${styles.result} ${styles.resultError}`}>
      {t.workspace.result.error(state.message)}
    </span>
  );
}

function PullResultMessage({
  state,
  fallback,
}: {
  state: PullActionState;
  fallback: string | null;
}) {
  if (state.kind === 'idle') {
    return fallback ? <span className={styles.lastResultMuted}>{fallback}</span> : null;
  }
  if (state.kind === 'pulled') {
    return <span className={`${styles.result} ${styles.resultSuccess}`}>{state.output}</span>;
  }
  if (state.kind === 'failed') {
    return <span className={`${styles.result} ${styles.resultError}`}>{state.output}</span>;
  }
  if (state.kind === 'no-workspace') {
    return (
      <span className={`${styles.result} ${styles.resultError}`}>
        {t.workspace.result.noWorkspace}
      </span>
    );
  }
  return (
    <span className={`${styles.result} ${styles.resultError}`}>
      {t.workspace.result.error(state.message)}
    </span>
  );
}
