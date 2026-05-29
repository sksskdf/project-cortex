'use client';

// Phase 16 — 위임 세션 worktree 격리 토글 (설정). 기본 OFF. 켜면 위임 claude 세션이 별도 git
// worktree(전용 브랜치)에서 돌아 메인 체크아웃(dev 서버가 보는)의 브랜치가 안 바뀐다.

import { useState, useTransition } from 'react';
import { ko as t } from '@/copy/ko';
import { toggleAgentWorktreeAction, type WorktreeActionState } from '@/actions/settings';
import styles from '@/app/settings/page.module.css';

export function WorktreeToggle({ initial }: { initial: boolean }) {
  const [pending, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(initial);
  const [state, setState] = useState<WorktreeActionState>({ kind: 'idle' });

  function onToggle() {
    const next = !enabled;
    setEnabled(next);
    setState({ kind: 'idle' });
    startTransition(async () => {
      const result = await toggleAgentWorktreeAction(next);
      if (result.kind === 'updated') setEnabled(result.enabled);
      else if (result.kind === 'error') setEnabled(initial);
      setState(result);
    });
  }

  return (
    <>
      <div className={styles.toggleRow}>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-busy={pending}
          disabled={pending}
          onClick={onToggle}
          className={`ds-btn ds-btn--md ${enabled ? 'ds-btn--filled-blue' : 'ds-btn--outlined-basic'}`}
        >
          <span className="ds-btn__label">
            {enabled ? t.settings.worktree.on : t.settings.worktree.off}
          </span>
        </button>
      </div>
      {state.kind === 'error' && (
        <div className={`${styles.result} ${styles.resultError}`} role="alert">
          {state.message}
        </div>
      )}
    </>
  );
}
