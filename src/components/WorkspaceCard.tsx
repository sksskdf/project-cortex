'use client';

// Phase 12 — 프로젝트 카드의 워크스페이스 등록 + git pull 영역.
// 카드 본문의 하단 한 줄로 통합 — 박스 안 박스 X, 상단 separator + 인라인 요소.

import { useState, useTransition } from 'react';
import { ko as t } from '@/copy/ko';
import {
  deleteWorkspaceAction,
  pullWorkspaceAction,
  registerWorkspaceAction,
  type PullActionState,
  type WorkspaceActionState,
} from '@/actions/workspace';
import { formatRelativeAge } from '@/lib/format';
import type { WorkspaceView } from '@/lib/workspace';
import styles from './WorkspaceCard.module.css';

// git pull 출력에서 "성공:" / "실패:" 접두어만 남기고 본문은 제거 (라인 줄이기).
function summarizeOutput(raw: string): string {
  // 첫 줄만, 80자 cap.
  const firstLine = raw.split('\n')[0] ?? raw;
  return firstLine.length > 80 ? firstLine.slice(0, 80) + '…' : firstLine;
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

  if (confirmRemove) {
    return (
      <div className={styles.registered}>
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
      </div>
    );
  }

  const buttonLabel = workspace.needsClone
    ? pending
      ? t.workspace.clonePending
      : t.workspace.cloneButton
    : pending
      ? t.workspace.pullPending
      : t.workspace.pullButton;

  return (
    <div className={styles.registered}>
      <div className={styles.registeredHead}>
        <span className={styles.pathIcon} aria-hidden>
          ▸
        </span>
        <span className={styles.path} title={workspace.localPath}>
          {workspace.localPath}
        </span>
        <button
          type="button"
          className={styles.removeBtn}
          onClick={() => setConfirmRemove(true)}
          disabled={pending}
          title={t.workspace.remove}
          aria-label={t.workspace.remove}
        >
          ×
        </button>
      </div>
      {workspace.needsClone && pullState.kind === 'idle' && (
        <p className={styles.cloneHint}>{t.workspace.needsCloneHint}</p>
      )}
      <div className={styles.actions}>
        <button
          type="button"
          className={
            workspace.needsClone
              ? 'ds-btn ds-btn--sm ds-btn--filled-blue'
              : 'ds-btn ds-btn--sm ds-btn--outlined-basic'
          }
          onClick={onPull}
          disabled={pending}
          aria-busy={pending && pullState.kind === 'idle'}
        >
          <span className="ds-btn__label">{buttonLabel}</span>
        </button>
        <PullResultInline state={pullState} workspace={workspace} />
      </div>
    </div>
  );
}

function ResultMessage({ state }: { state: WorkspaceActionState }) {
  if (state.kind === 'idle') return null;
  if (state.kind === 'registered' || state.kind === 'updated') {
    return (
      <span className={`${styles.result} ${styles.resultSuccess}`}>
        <span className={styles.resultDot} aria-hidden />
        <span className={styles.resultText}>
          {state.kind === 'registered' ? t.workspace.result.registered : t.workspace.result.updated}
        </span>
      </span>
    );
  }
  if (state.kind === 'invalid-path') {
    return (
      <span className={`${styles.result} ${styles.resultError}`}>
        <span className={styles.resultDot} aria-hidden />
        <span className={styles.resultText}>{t.workspace.result.invalidPath(state.reason)}</span>
      </span>
    );
  }
  if (state.kind === 'no-project') {
    return (
      <span className={`${styles.result} ${styles.resultError}`}>
        <span className={styles.resultDot} aria-hidden />
        <span className={styles.resultText}>{t.workspace.result.noProject}</span>
      </span>
    );
  }
  if (state.kind === 'deleted') {
    return (
      <span className={`${styles.result} ${styles.resultSuccess}`}>
        <span className={styles.resultDot} aria-hidden />
        <span className={styles.resultText}>{t.workspace.result.deleted}</span>
      </span>
    );
  }
  if (state.kind === 'not-found') {
    return (
      <span className={`${styles.result} ${styles.resultError}`}>
        <span className={styles.resultDot} aria-hidden />
        <span className={styles.resultText}>{t.workspace.result.noWorkspace}</span>
      </span>
    );
  }
  return (
    <span className={`${styles.result} ${styles.resultError}`}>
      <span className={styles.resultDot} aria-hidden />
      <span className={styles.resultText}>{t.workspace.result.error(state.message)}</span>
    </span>
  );
}

// 라이브 결과 (state) 우선, 없으면 마지막 sync 시각만 표시 (fallback 텍스트는 title 에).
function PullResultInline({
  state,
  workspace,
}: {
  state: PullActionState;
  workspace: WorkspaceView;
}) {
  if (state.kind === 'pulled' || state.kind === 'cloned') {
    return (
      <span className={`${styles.result} ${styles.resultSuccess}`} title={state.output}>
        <span className={styles.resultDot} aria-hidden />
        <span className={styles.resultText}>{summarizeOutput(state.output)}</span>
      </span>
    );
  }
  if (state.kind === 'failed') {
    return (
      <span className={`${styles.result} ${styles.resultError}`} title={state.output}>
        <span className={styles.resultDot} aria-hidden />
        <span className={styles.resultText}>{summarizeOutput(state.output)}</span>
      </span>
    );
  }
  if (state.kind === 'no-workspace') {
    return (
      <span className={`${styles.result} ${styles.resultError}`}>
        <span className={styles.resultDot} aria-hidden />
        <span className={styles.resultText}>{t.workspace.result.noWorkspace}</span>
      </span>
    );
  }
  if (state.kind === 'error') {
    return (
      <span className={`${styles.result} ${styles.resultError}`} title={state.message}>
        <span className={styles.resultDot} aria-hidden />
        <span className={styles.resultText}>{t.workspace.result.error(state.message)}</span>
      </span>
    );
  }
  // idle — 마지막 sync 시각.
  if (workspace.lastPullAt) {
    return (
      <span className={styles.lastPull} title={workspace.lastPullResult ?? undefined}>
        {t.workspace.lastPull(formatRelativeAge(workspace.lastPullAt.getTime()))}
      </span>
    );
  }
  return null;
}
