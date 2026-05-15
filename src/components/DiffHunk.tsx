import type { CodeLineKind, Hunk } from '@/lib/types';
import { ko as t } from '@/copy/ko';
import styles from './DiffHunk.module.css';

const lineKindClass: Record<CodeLineKind, string> = {
  ctx: styles.lineCtx,
  add: styles.lineAdd,
  del: styles.lineDel,
  'hunk-head': styles.lineHead,
};

function checkIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function alertIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx={12} cy={12} r={10} />
      <line x1={12} y1={8} x2={12} y2={12} />
      <line x1={12} y1={16} x2={12.01} y2={16} />
    </svg>
  );
}

function infoIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx={12} cy={12} r={10} />
      <line x1={12} y1={16} x2={12} y2={12} />
      <line x1={12} y1={8} x2={12.01} y2={8} />
    </svg>
  );
}

function helpIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx={12} cy={12} r={10} />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1={12} y1={17} x2={12.01} y2={17} />
    </svg>
  );
}

function signFor(kind: CodeLineKind): string {
  if (kind === 'add') return '+';
  if (kind === 'del') return '−';
  if (kind === 'hunk-head') return '';
  return ' ';
}

export function DiffHunk({ hunk }: { hunk: Hunk }) {
  if (hunk.kind === 'collapsed') {
    const [pre, ...rest] = hunk.summary.split('{highlight}');
    const post = rest.join('{highlight}');
    return (
      <div className={styles.collapsed}>
        <span className={styles.collapsedCheck} aria-hidden="true">
          {checkIcon()}
        </span>
        <span className={styles.collapsedLabel}>
          {pre}
          <b>{hunk.summaryHighlight}</b>
          {post}
          {' · '}
          {t.pr.collapsedHunk.lines(hunk.lineCount)}
        </span>
      </div>
    );
  }

  const reasonClass =
    hunk.reason.tone === 'alert'
      ? `${styles.reason} ${styles.reasonAlert}`
      : hunk.reason.tone === 'info'
        ? `${styles.reason} ${styles.reasonInfo}`
        : styles.reason;
  const reasonIcon =
    hunk.reason.tone === 'alert'
      ? alertIcon()
      : hunk.reason.tone === 'info'
        ? infoIcon()
        : alertIcon();

  return (
    <div className={styles.hunk}>
      <div className={reasonClass}>
        {reasonIcon}
        <div>
          <b>{t.pr.hunk.reasonLabel}</b> {hunk.reason.text}
        </div>
      </div>
      <div className={styles.code}>
        {hunk.lines.map((line, i) => (
          <div key={i} className={`${styles.line} ${lineKindClass[line.kind]}`}>
            <span className={styles.lineNum}>{line.lineNumber ?? ''}</span>
            <span className={styles.lineSign}>{signFor(line.kind)}</span>
            <span className={styles.lineText}>{line.text}</span>
          </div>
        ))}
      </div>
      {hunk.aiComment && (
        <div className={styles.aiComment}>
          <div className={styles.aiCommentHead}>
            {helpIcon()}
            {t.pr.hunk.aiCommentLabel}
          </div>
          <div className={styles.aiCommentBody}>
            {hunk.aiComment
              .split('`')
              .map((segment, i) =>
                i % 2 === 0 ? <span key={i}>{segment}</span> : <code key={i}>{segment}</code>,
              )}
          </div>
        </div>
      )}
    </div>
  );
}
