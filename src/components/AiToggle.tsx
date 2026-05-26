'use client';

import { useState, useTransition } from 'react';
import { ko as t } from '@/copy/ko';
import { toggleAiEnabledAction, type SettingsActionState } from '@/actions/settings';
import styles from '@/app/settings/page.module.css';

type Props = {
  initial: boolean;
};

export function AiToggle({ initial }: Props) {
  const [pending, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(initial);
  const [state, setState] = useState<SettingsActionState>({ kind: 'idle' });

  function onToggle() {
    const next = !enabled;
    setEnabled(next); // optimistic
    setState({ kind: 'idle' });
    startTransition(async () => {
      const result = await toggleAiEnabledAction(next);
      if (result.kind === 'updated') {
        setEnabled(result.aiEnabled);
      } else if (result.kind === 'error') {
        setEnabled(initial); // 롤백
      }
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
          <span className="ds-btn__label">{enabled ? t.settings.ai.on : t.settings.ai.off}</span>
        </button>
      </div>
      <SettingsResult state={state} />
    </>
  );
}

function SettingsResult({ state }: { state: SettingsActionState }) {
  if (state.kind === 'idle') return null;
  if (state.kind === 'updated') {
    return (
      <div className={`${styles.result} ${styles.resultSuccess}`} role="status" aria-live="polite">
        {state.aiEnabled ? t.settings.ai.result.enabled : t.settings.ai.result.disabled}
      </div>
    );
  }
  return (
    <div className={`${styles.result} ${styles.resultError}`} role="alert">
      {t.settings.ai.result.error(state.message)}
    </div>
  );
}
