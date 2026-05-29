'use client';

import Link from 'next/link';
import type { PR, ReasonTone, TagTone } from '@/lib/types';
import { ko as t } from '@/copy/ko';
import { AuthorChip } from './AuthorChip';
import { Gauge } from './Gauge';
import { AlertIcon, InfoIcon } from './icons';
import { PRRowInlineActions } from './PRRowInlineActions';
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

// 행 자체 강조 — Cortex 가 위험 분류한 PR 은 좌측 accent + (alert 만) 배경 틴트.
const rowToneClass: Record<ReasonTone, string> = {
  alert: styles.rowAlert,
  warn: styles.rowWarn,
  info: '',
};

// onOpen 가 있으면 행을 클릭 시 페이지 이동 대신 그 핸들러(보통 액션 모달 열기)를 호출하는
// 버튼으로 렌더한다. 이 모드에선 인라인 액션을 숨긴다 — operation 은 모달이 담당.
export function PRRow({
  pr,
  selectable = false,
  onOpen,
}: {
  pr: PR;
  selectable?: boolean;
  onOpen?: () => void;
}) {
  const reasonIcon = pr.reason.tone === 'alert' ? <AlertIcon /> : <InfoIcon />;
  const rowClass = `${styles.row} ${rowToneClass[pr.reason.tone]}`.trim();
  const inner = (
    <>
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
          {pr.automation && (
            <span className={styles.automation} role="status">
              <span className={styles.automationDot} aria-hidden="true" />
              {t.row.automation[pr.automation]}
            </span>
          )}
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
      {!onOpen && pr.actions && <PRRowInlineActions viewId={pr.id} actions={pr.actions} />}
    </>
  );

  if (onOpen) {
    return (
      <button
        type="button"
        className={`${rowClass} ${styles.rowButton}`}
        onClick={onOpen}
        aria-haspopup="dialog"
      >
        {inner}
      </button>
    );
  }
  return (
    <Link href={`/pr/${pr.id}`} className={rowClass}>
      {inner}
    </Link>
  );
}
