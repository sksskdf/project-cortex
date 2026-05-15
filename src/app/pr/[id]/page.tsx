import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ko as t } from '@/copy/ko';
import { AuthorChip } from '@/components/AuthorChip';
import { DiffHunk } from '@/components/DiffHunk';
import { inboxQueue } from '@/mocks/inbox';
import { prDetail, type AiCheck, type TreeFile, type TreeGroup } from '@/mocks/pr-detail';
import type { FileStatus, GaugeTier, PR, TagTone } from '@/lib/types';
import styles from './page.module.css';

const tagToneClass: Record<TagTone, string> = {
  red: 'ds-tag--red',
  yellow: 'ds-tag--yellow',
  purple: 'ds-tag--purple',
  green: 'ds-tag--green',
  gray: 'ds-tag--gray',
  'sky-blue': 'ds-tag--sky-blue',
};

const fileStatusClass: Record<FileStatus, string> = {
  ok: styles.fileBlockStatusOk,
  warn: styles.fileBlockStatusWarn,
  alert: styles.fileBlockStatusAlert,
};

const treeItemStatusClass: Record<FileStatus, string> = {
  ok: styles.treeItemStatusOk,
  warn: styles.treeItemStatusWarn,
  alert: styles.treeItemStatusAlert,
};

const aiCheckIconClass: Record<AiCheck['tone'], string> = {
  ok: styles.aiCheckIconOk,
  warn: styles.aiCheckIconWarn,
  alert: styles.aiCheckIconAlert,
};

const gaugeBarClass: Record<GaugeTier, string> = {
  success: styles.prGaugeBarSuccess,
  blue: styles.prGaugeBarBlue,
  warning: styles.prGaugeBarWarning,
  error: styles.prGaugeBarError,
};

const gaugeNumClass: Record<GaugeTier, string> = {
  success: styles.prGaugeNumSuccess,
  blue: styles.prGaugeNumBlue,
  warning: styles.prGaugeNumWarning,
  error: styles.prGaugeNumError,
};

const GAUGE_RADIUS = 40;
const GAUGE_CIRCUMFERENCE = 2 * Math.PI * GAUGE_RADIUS;

function chevronLeftIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="15 18 9 12 15 6" />
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

function warnIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1={12} y1={8} x2={12} y2={12} />
      <line x1={12} y1={16} x2={12.01} y2={16} />
    </svg>
  );
}

function statusIcon(status: FileStatus) {
  return status === 'ok' ? checkIcon() : warnIcon();
}

function PRGauge({ value, tier }: { value: number; tier: GaugeTier }) {
  const offset = GAUGE_CIRCUMFERENCE - (value / 100) * GAUGE_CIRCUMFERENCE;
  return (
    <div className={styles.prGauge}>
      <svg className={styles.prGaugeSvg} width={96} height={96} viewBox="0 0 96 96">
        <circle className={styles.prGaugeTrack} cx={48} cy={48} r={GAUGE_RADIUS} strokeWidth={7} />
        <circle
          className={`${styles.prGaugeBar} ${gaugeBarClass[tier]}`}
          cx={48}
          cy={48}
          r={GAUGE_RADIUS}
          strokeWidth={7}
          strokeDasharray={GAUGE_CIRCUMFERENCE}
          strokeDashoffset={offset}
        />
      </svg>
      <div className={styles.prGaugeCenter}>
        <span className={`${styles.prGaugeNum} ${gaugeNumClass[tier]}`}>{value}</span>
        <span className={styles.prGaugeLabel}>{t.pr.confidenceLabel}</span>
      </div>
    </div>
  );
}

function TreeItem({ file }: { file: TreeFile }) {
  return (
    <Link
      href={`#${file.path}`}
      className={`${styles.treeItem} ${file.active ? styles.treeItemActive : ''}`}
    >
      <span className={`${styles.treeItemStatus} ${treeItemStatusClass[file.status]}`}>
        {statusIcon(file.status)}
      </span>
      <span className={styles.treeItemName}>{file.path}</span>
      <span className={styles.treeItemDiff}>{t.pr.fileDiff(file.additions, file.deletions)}</span>
    </Link>
  );
}

function TreeGroupSection({ group }: { group: TreeGroup }) {
  return (
    <>
      <div className={styles.treeGroup}>{t.pr.tree.group[group.groupKey]}</div>
      <div className={styles.treeList}>
        {group.files.map((file) => (
          <TreeItem key={file.path} file={file} />
        ))}
        {group.collapsedExtraCount && group.collapsedExtraCount > 0 ? (
          <div className={styles.treeItemMore}>
            {t.pr.tree.group.more(group.collapsedExtraCount)}
          </div>
        ) : null}
      </div>
    </>
  );
}

const aiCheckLabel: Record<AiCheck['key'], string> = {
  tests: t.pr.aiCheck.tests,
  coverage: t.pr.aiCheck.coverage,
  risk: t.pr.aiCheck.risk,
};

export default async function PRDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pr: PR | undefined = inboxQueue.find((p) => p.id === id);
  if (!pr) {
    notFound();
  }
  const detail = prDetail;

  return (
    <div className={styles.layout}>
      <aside className={styles.tree} aria-label={t.pr.tree.ariaLabel}>
        <div className={styles.treeSummary}>
          <div className={styles.treeSummaryRow}>
            <span className={styles.treeSummaryLabel}>{t.pr.tree.summary.filesChanged}</span>
            <span className={styles.treeSummaryVal}>{detail.hunkSummary.filesChanged}</span>
          </div>
          <div className={styles.treeSummaryRow}>
            <span className={styles.treeSummaryLabel}>{t.pr.tree.summary.linesAdded}</span>
            <span className={`${styles.treeSummaryVal} ${styles.treeSummaryValAdd}`}>
              +{detail.hunkSummary.additions}
            </span>
          </div>
          <div className={styles.treeSummaryRow}>
            <span className={styles.treeSummaryLabel}>{t.pr.tree.summary.linesDeleted}</span>
            <span className={`${styles.treeSummaryVal} ${styles.treeSummaryValDel}`}>
              −{detail.hunkSummary.deletions}
            </span>
          </div>
          <div className={styles.treeSummaryRow}>
            <span className={styles.treeSummaryLabel}>{t.pr.tree.summary.autoApprovable}</span>
            <span className={styles.treeSummaryVal}>
              {t.pr.tree.summary.hunkCount(detail.hunkSummary.autoApprovableHunks)}
            </span>
          </div>
          <div className={styles.treeSummaryRow}>
            <span className={styles.treeSummaryLabel}>{t.pr.tree.summary.needsReview}</span>
            <span className={`${styles.treeSummaryVal} ${styles.treeSummaryValAlert}`}>
              {t.pr.tree.summary.hunkCount(
                detail.hunkSummary.totalHunks - detail.hunkSummary.autoApprovableHunks,
              )}
            </span>
          </div>
        </div>

        {detail.tree.map((group) => (
          <TreeGroupSection key={group.groupKey} group={group} />
        ))}
      </aside>

      <main className={styles.diffArea}>
        <Link href="/inbox" className={styles.back}>
          {chevronLeftIcon()}
          {t.pr.backToInbox}
        </Link>

        <div className={styles.head}>
          <div className={styles.titleWrap}>
            <h1 className={styles.title}>{pr!.title}</h1>
            <div className={styles.sub}>
              {pr!.repo && <span className={styles.subMono}>{pr!.repo}</span>}
              {pr!.repo && pr!.number !== undefined && (
                <span className={styles.subDot} aria-hidden="true" />
              )}
              {pr!.number !== undefined && <span className={styles.subMono}>#{pr!.number}</span>}
              <span className={styles.subDot} aria-hidden="true" />
              <AuthorChip author={pr!.author} suffix={t.pr.authorSuffix} />
              <span className={styles.subDot} aria-hidden="true" />
              <span>{pr!.ageText}</span>
              {pr!.tags.length > 0 && <span className={styles.subDot} aria-hidden="true" />}
              {pr!.tags.map((tag) => (
                <span key={tag.label} className={`ds-tag ds-tag--md ${tagToneClass[tag.tone]}`}>
                  {tag.label}
                </span>
              ))}
            </div>
          </div>
          <PRGauge value={pr!.gauge.value} tier={pr!.gauge.tier} />
        </div>

        <section className={styles.aiCard} aria-label={t.pr.aiSummary.ariaLabel}>
          <div className={styles.aiCardHead}>
            <span className={styles.aiCardIcon} aria-hidden="true">
              {helpIcon()}
            </span>
            <div>
              <div className={styles.aiCardTitle}>{t.pr.aiSummary.title}</div>
              <div className={styles.aiCardTitleSub}>
                {detail.aiSummary.analyzedAgo} {t.pr.aiSummary.subtitle}
              </div>
            </div>
          </div>
          <div className={styles.aiCardSummary}>
            {detail.aiSummary.summarySegments.map((seg, i) =>
              seg.emphasis ? (
                <b key={i} className={styles.aiCardEmphasis}>
                  {seg.text}
                </b>
              ) : (
                <span key={i}>{seg.text}</span>
              ),
            )}
          </div>
          <div className={styles.aiCardChecks}>
            {detail.aiSummary.checks.map((check) => (
              <div key={check.key} className={styles.aiCheck}>
                <span className={`${styles.aiCheckIcon} ${aiCheckIconClass[check.tone]}`}>
                  {check.tone === 'ok' ? checkIcon() : warnIcon()}
                </span>
                <div>
                  <div className={styles.aiCheckLabel}>{aiCheckLabel[check.key]}</div>
                  <div className={styles.aiCheckValue}>{check.value}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {detail.files.map((file) => (
          <section key={file.path} className={styles.fileBlock} id={file.path}>
            <header className={styles.fileBlockHead}>
              <span className={`${styles.fileBlockStatus} ${fileStatusClass[file.status]}`}>
                {statusIcon(file.status)}
              </span>
              <span className={styles.fileBlockName}>{file.path}</span>
              <span className={styles.fileBlockDiff}>
                <span className={styles.fileBlockDiffPlus}>+{file.additions}</span>{' '}
                <span className={styles.fileBlockDiffMinus}>−{file.deletions}</span>
              </span>
            </header>
            {file.hunks.map((hunk) => (
              <DiffHunk key={hunk.id} hunk={hunk} />
            ))}
          </section>
        ))}

        <div className={styles.actionBar}>
          <div className={styles.actionBarLeft}>
            {t.pr.actionBar.summary(
              detail.hunkSummary.autoApprovableHunks,
              detail.hunkSummary.totalHunks,
            )}
          </div>
          <div className={styles.actionBarRight}>
            <button type="button" className="ds-btn ds-btn--md ds-btn--outlined-red">
              <span className="ds-btn__label">{t.pr.actionBar.requestChanges}</span>
            </button>
            <button type="button" className="ds-btn ds-btn--md ds-btn--outlined-basic">
              <span className="ds-btn__label">{t.pr.actionBar.autoApprove}</span>
            </button>
            <button type="button" className="ds-btn ds-btn--md ds-btn--filled-blue">
              <span className="ds-btn__label">{t.pr.actionBar.mergeAll}</span>
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
