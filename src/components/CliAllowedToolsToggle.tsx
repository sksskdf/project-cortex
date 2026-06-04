'use client';

// Phase 13.5 R4 — claude CLI 자동화 도구 권한 정밀화 토글(설정). 기본 OFF — 켜기 전 머신에서
// 자동 수정이 정상 동작하는지 1회 검증해야(잘못된 허용목록은 자동화를 깨뜨릴 수 있음).
// OFF 면 기존 `--dangerously-skip-permissions` 폴백 그대로(무회귀).

import { useState, useTransition } from 'react';
import { ko as t } from '@/copy/ko';
import { toggleCliAllowedToolsAction, type CliAllowedToolsActionState } from '@/actions/settings';
import styles from '@/app/settings/page.module.css';

export function CliAllowedToolsToggle({ initial }: { initial: boolean }) {
  const [pending, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(initial);
  const [state, setState] = useState<CliAllowedToolsActionState>({ kind: 'idle' });

  function onToggle() {
    const next = !enabled;
    setEnabled(next);
    setState({ kind: 'idle' });
    startTransition(async () => {
      const result = await toggleCliAllowedToolsAction(next);
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
            {enabled ? t.settings.cliAllowedTools.on : t.settings.cliAllowedTools.off}
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
