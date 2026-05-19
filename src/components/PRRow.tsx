import Link from 'next/link';
import type { PR, ReasonTone, TagTone } from '@/lib/types';
import { ko as t } from '@/copy/ko';
import { AuthorChip } from './AuthorChip';
import { Gauge } from './Gauge';
import { AlertIcon, InfoIcon } from './icons';
import styles from './PRRow.module.css';

const tagToneClass: Record<TagTone, string> = {
  red: 'ds-tag--red',
  yellow: 'ds-tag--yellow',
  purple: 'ds-tag--purple',
  green: 'ds-tag--green',
  gray: 'ds-tag--gray',
  'sky-blue': 'ds-tag--sky-blue',
  cyan: 'ds-tag--cyan',
};

const reasonToneClass: Record<ReasonTone, string> = {
  alert: styles.reasonAlert,
  warn: styles.reasonWarn,
  info: styles.reasonInfo,
};

export function PRRow({ pr, selectable = false }: { pr: PR; selectable?: boolean }) {
  const reasonIcon = pr.reason.tone === 'alert' ? <AlertIcon /> : <InfoIcon />;
  return (
    <Link href={`/pr/${pr.id}`} className={styles.row}>
      {selectable && <span className={styles.check} aria-hidden="true" />}
      <Gauge value={pr.gauge.value} tier={pr.gauge.tier} />
      <div className={styles.body}>
        <div className={styles.top}>
          <span className={styles.title}>{pr.title}</span>
          {pr.repo && pr.number !== undefined && (
            <span className={styles.repo}>
              {pr.repo} · #{pr.number}
            </span>
          )}
        </div>
        <div className={styles.top}>
          <AuthorChip author={pr.author} />
          {pr.tags.map((tag) => (
            <span key={tag.label} className={`ds-tag ds-tag--md ${tagToneClass[tag.tone]}`}>
              {tag.label}
            </span>
          ))}
        </div>
        <div className={`${styles.reason} ${reasonToneClass[pr.reason.tone]}`}>
          {reasonIcon}
          {pr.reason.text}
        </div>
        <div className={styles.meta}>
          <span className={styles.diff}>
            <span className={styles.diffPlus}>+{pr.additions}</span>
            <span className={styles.diffMinus}>−{pr.deletions}</span>
          </span>
          {pr.fileCount !== undefined && (
            <>
              <span className={styles.metaDot} aria-hidden="true" />
              <span>{t.inbox.meta.fileCount(pr.fileCount)}</span>
            </>
          )}
          <span className={styles.metaDot} aria-hidden="true" />
          <span>{pr.ageText}</span>
        </div>
      </div>
    </Link>
  );
}
