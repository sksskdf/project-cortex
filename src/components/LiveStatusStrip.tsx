// Phase 21 (G1) — 라이브 상태 스트립. "지금" 종합 한 줄: 진행 중 위임·자동화·검토 대기·미확인
// 머지. 각 숫자는 해당 목록으로 링크. 서버 컴포넌트(인터랙션 없음) — getLiveStatus 결과만 렌더.

import Link from 'next/link';
import { ko as t } from '@/copy/ko';
import type { LiveStatus } from '@/lib/live-status';
import { InfoTip } from './InfoTip';
import styles from './LiveStatusStrip.module.css';

type Segment = { key: keyof LiveStatus; href: string; live?: boolean };

const SEGMENTS: ReadonlyArray<Segment> = [
  { key: 'activeDelegations', href: '/issues', live: true },
  { key: 'automationInFlight', href: '/inbox', live: true },
  { key: 'reviewPending', href: '/inbox' },
  { key: 'unreadMerges', href: '/inbox' },
];

export function LiveStatusStrip({ status }: { status: LiveStatus }) {
  const s = t.dashboard.liveStatus;
  return (
    <div className={styles.strip} role="status" aria-label={s.ariaLabel}>
      {SEGMENTS.map(({ key, href, live }) => {
        const n = status[key];
        const active = n > 0;
        return (
          <InfoTip key={key} text={s.hint[key]}>
            <Link
              href={href}
              className={`${styles.seg} ${active ? styles.segActive : styles.segIdle}`}
            >
              {live && active && <span className={styles.pulse} aria-hidden />}
              <span className={styles.num}>{n}</span>
              <span className={styles.label}>{s.label[key]}</span>
            </Link>
          </InfoTip>
        );
      })}
    </div>
  );
}
