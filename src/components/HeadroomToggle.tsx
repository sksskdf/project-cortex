'use client';

// Headroom 통합 토글 (설정). 기본 OFF. 켜면 headless 자동화(사전 리뷰·테스트 수정·충돌 해결·
// 리뷰 반영)가 `headroom wrap claude ...` 로 spawn 되어 컨텍스트가 로컬 압축됨. 미설치 머신은
// 켜도 fallback(원본 claude 직접 spawn) + warning 로그.

import { useState, useTransition } from 'react';
import { ko as t } from '@/copy/ko';
import { toggleHeadroomAction, type HeadroomActionState } from '@/actions/settings';
import styles from '@/app/settings/page.module.css';

export function HeadroomToggle({ initial, available }: { initial: boolean; available: boolean }) {
  const [pending, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(initial);
  const [state, setState] = useState<HeadroomActionState>({ kind: 'idle' });

  function onToggle() {
    const next = !enabled;
    setEnabled(next);
    setState({ kind: 'idle' });
    startTransition(async () => {
      const result = await toggleHeadroomAction(next);
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
            {enabled ? t.settings.headroom.on : t.settings.headroom.off}
          </span>
        </button>
      </div>
      {/* binary 미설치 + 토글 ON 이면 fallback 안내 — 무회귀지만 압축 효과 없음. */}
      {enabled && !available && (
        <div className={`${styles.result} ${styles.resultError}`} role="alert">
          {t.settings.headroom.unavailable}
        </div>
      )}
      {state.kind === 'error' && (
        <div className={`${styles.result} ${styles.resultError}`} role="alert">
          {state.message}
        </div>
      )}
    </>
  );
}
