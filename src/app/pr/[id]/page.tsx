import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ko as t } from '@/copy/ko';
import { AuthorChip } from '@/components/AuthorChip';
import { DiffHunk } from '@/components/DiffHunk';
import { CheckIcon, ChevronLeftIcon, HelpIcon, WarnIcon } from '@/components/icons';
import { PRActions } from '@/components/PRActions';
import { type AiCheck, type TreeFile, type TreeGroup } from '@/fixtures/pr-detail';
import { getPRDetail } from '@/lib/pr';
import type { FileStatus, GaugeTier, TagTone } from '@/lib/types';
import styles from './page.module.css';

const tagToneClass: Record<TagTone, string> = {
  red: 'ds-tag--red',
  yellow: 'ds-tag--yellow',
  purple: 'ds-tag--purple',
  green: 'ds-tag--green',
  gray: 'ds-tag--gray',
  'sky-blue': 'ds-tag--sky-blue',
  cyan: 'ds-tag--cyan',
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

function statusIcon(status: FileStatus) {
  return status === 'ok' ? <CheckIcon /> : <WarnIcon />;
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
  // 같은 페이지 안 anchor 점프 — next/link 의 prefetch · client routing 불필요하고,
  // file.path 가 src/app/cluster/[id]/page.tsx 처럼 `[...]` 를 포함하면 next/link 가
  // 동적 라우트 패턴으로 오인하므로 native <a> 사용.
  return (
    <a
      href={`#${file.path}`}
      className={`${styles.treeItem} ${file.active ? styles.treeItemActive : ''}`}
    >
      <span className={`${styles.treeItemStatus} ${treeItemStatusClass[file.status]}`}>
        {statusIcon(file.status)}
      </span>
      <span className={styles.treeItemName}>{file.path}</span>
      <span className={styles.treeItemDiff}>{t.pr.fileDiff(file.additions, file.deletions)}</span>
    </a>
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
  const view = await getPRDetail(id);
  if (!view) {
    notFound();
  }
  const { pr, fixture, hunkSummary, source, isMerged, branchDeleted, body } = view;
  const detail = { ...fixture, hunkSummary };
  const bodyText = body?.trim() ?? '';

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
          <ChevronLeftIcon />
          {t.pr.backToInbox}
        </Link>

        <div className={styles.head}>
          <div className={styles.titleWrap}>
            <h1 className={styles.title}>{pr.title}</h1>
            <div className={styles.sub}>
              {pr.repo && <span className={styles.subMono}>{pr.repo}</span>}
              {pr.repo && pr.number !== undefined && (
                <span className={styles.subDot} aria-hidden="true" />
              )}
              {pr.number !== undefined && <span className={styles.subMono}>#{pr.number}</span>}
              <span className={styles.subDot} aria-hidden="true" />
              <AuthorChip author={pr.author} suffix={t.pr.authorSuffix} />
              <span className={styles.subDot} aria-hidden="true" />
              <span>{pr.ageText}</span>
              {pr.tags.length > 0 && <span className={styles.subDot} aria-hidden="true" />}
              {pr.tags.map((tag) => (
                <span key={tag.label} className={`ds-tag ds-tag--md ${tagToneClass[tag.tone]}`}>
                  {tag.label}
                </span>
              ))}
            </div>
          </div>
          <PRGauge value={pr.gauge.value} tier={pr.gauge.tier} />
        </div>

        {source === 'fixture' && (
          <div className={styles.fixtureBanner} role="note">
            {t.pr.fixtureBanner}
          </div>
        )}

        {bodyText.length > 0 && (
          <section className={styles.bodyCard} aria-label={t.pr.body.ariaLabel}>
            <h2 className={styles.bodyCardTitle}>{t.pr.body.title}</h2>
            <div className={styles.bodyContent}>{bodyText}</div>
          </section>
        )}

        <section className={styles.aiCard} aria-label={t.pr.aiSummary.ariaLabel}>
          <div className={styles.aiCardHead}>
            <span className={styles.aiCardIcon} aria-hidden="true">
              <HelpIcon />
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
                  {check.tone === 'ok' ? <CheckIcon /> : <WarnIcon />}
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
            {/* fixture 폴백(시드) PR 은 GitHub 머지 못 함 — source 가 'analyzed' 일 때만 활성. */}
            <PRActions
              viewId={pr.id}
              canMerge={source === 'analyzed'}
              isMerged={isMerged}
              branchDeleted={branchDeleted}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
