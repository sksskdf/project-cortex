'use client';

import { useState, useTransition } from 'react';
import { ko as t } from '@/copy/ko';
import { markPRReadAction } from '@/actions/pr';
import styles from './PRReadToggle.module.css';

type Props = {
  viewId: string;
  initialRead: boolean;
};

// Phase 20 — PR 확인/미확인 토글. 자동 머지가 늘면서 "이미 머지됐지만 내가 안 본" PR 추적용.
// 낙관적 토글: 클릭 즉시 상태 반영, 실패하면 되돌린다.
export function PRReadToggle({ viewId, initialRead }: Props) {
  const [read, setRead] = useState(initialRead);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    const next = !read;
    setRead(next); // 낙관적.
    setError(null);
    startTransition(async () => {
      const res = await markPRReadAction(viewId, next);
      if (res.kind === 'error') {
        setRead(!next); // 롤백.
        setError(res.message);
      }
    });
  }

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={`ds-btn ds-btn--sm ${read ? 'ds-btn--ghost-basic' : 'ds-btn--solid-primary'}`}
        onClick={toggle}
        disabled={pending}
        aria-busy={pending}
        aria-pressed={read}
        title={read ? t.pr.read.markUnread : t.pr.read.markRead}
      >
        <span className={`${styles.dot} ${read ? styles.dotRead : styles.dotUnread}`} aria-hidden />
        <span className="ds-btn__label">{read ? t.pr.read.read : t.pr.read.markRead}</span>
      </button>
      {error && (
        <span className={styles.error} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
