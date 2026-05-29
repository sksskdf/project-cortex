'use client';

// 라우트 에러 경계 — 서버 컴포넌트/서버 액션에서 throw 된 예외를 잡아 깔끔한 카드로 표시.
// Next.js App Router 규약: { error, reset } props. AppShell 의 <main> 안에서 렌더된다.
// prod 에서 error.message 를 노출하지 않고(정보 유출 방지) 친절한 한국어 + digest 만 보여준다.

import { useEffect } from 'react';
import Link from 'next/link';
import { ko as t } from '@/copy/ko';
import { AlertIcon } from '@/components/icons';
import styles from './boundary.module.css';

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className={styles.wrap}>
      <div className={styles.card} role="alert">
        <span className={styles.icon} aria-hidden="true">
          <AlertIcon />
        </span>
        <h1 className={styles.title}>{t.errors.title}</h1>
        <p className={styles.desc}>{t.errors.desc}</p>
        {error.digest ? <p className={styles.digest}>{t.errors.digest(error.digest)}</p> : null}
        <div className={styles.actions}>
          <button
            type="button"
            className="ds-btn ds-btn--md ds-btn--filled-blue"
            onClick={() => reset()}
          >
            <span className="ds-btn__label">{t.errors.retry}</span>
          </button>
          <Link href="/" className="ds-btn ds-btn--md ds-btn--outlined-basic">
            <span className="ds-btn__label">{t.errors.home}</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
