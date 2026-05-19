import type { CodeLineKind, Hunk } from '@/lib/types';
import { ko as t } from '@/copy/ko';
import { AlertIcon, CheckIcon, HelpIcon, InfoIcon } from './icons';
import styles from './DiffHunk.module.css';

const lineKindClass: Record<CodeLineKind, string> = {
  ctx: styles.lineCtx,
  add: styles.lineAdd,
  del: styles.lineDel,
  'hunk-head': styles.lineHead,
};

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
          <CheckIcon />
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
  const reasonIcon = hunk.reason.tone === 'info' ? <InfoIcon /> : <AlertIcon />;

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
            <HelpIcon />
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
