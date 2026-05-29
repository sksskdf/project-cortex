// 앱 전역 404 — notFound() 호출(pr/[id], issues/[id], cluster/[id], roadmap)과
// 존재하지 않는 경로 모두를 잡는다. AppShell 의 <main> 안에서 렌더된다.

import Link from 'next/link';
import { ko as t } from '@/copy/ko';
import { InfoIcon } from '@/components/icons';
import styles from './boundary.module.css';

export default function NotFound() {
  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <span className={`${styles.icon} ${styles.iconMuted}`} aria-hidden="true">
          <InfoIcon />
        </span>
        <h1 className={styles.title}>{t.errors.notFoundTitle}</h1>
        <p className={styles.desc}>{t.errors.notFoundDesc}</p>
        <div className={styles.actions}>
          <Link href="/" className="ds-btn ds-btn--md ds-btn--filled-blue">
            <span className="ds-btn__label">{t.errors.home}</span>
          </Link>
          <Link href="/inbox" className="ds-btn ds-btn--md ds-btn--outlined-basic">
            <span className="ds-btn__label">{t.errors.notFoundInbox}</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
