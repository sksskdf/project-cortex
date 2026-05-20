import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ko as t } from '@/copy/ko';
import { ClusterActions } from '@/components/ClusterActions';
import { CheckIcon, ChevronLeftIcon, ClusterIcon, InfoIcon } from '@/components/icons';
import type { ClusterDiffRowFixture } from '@/fixtures/cluster';
import { getClusterDetail, type ClusterPRItem } from '@/lib/cluster';
import type { CodeLineKind, TagTone } from '@/lib/types';
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

const lineKindClass: Record<CodeLineKind, string> = {
  ctx: styles.lineCtx,
  add: styles.lineAdd,
  del: styles.lineDel,
  'hunk-head': styles.lineCtx,
};

function signFor(kind: CodeLineKind): string {
  if (kind === 'add') return '+';
  if (kind === 'del') return '−';
  return ' ';
}

function ClusterPRItemCard({ pr }: { pr: ClusterPRItem }) {
  return (
    <Link
      href={`/pr/${pr.id}`}
      className={`${styles.prItem} ${pr.active ? styles.prItemActive : ''}`}
    >
      <div className={styles.prItemTop}>
        <span className={styles.prItemCheck} aria-hidden="true">
          <CheckIcon />
        </span>
        <span className={styles.prItemId}>#{pr.number}</span>
        <span
          className={`${styles.prItemSimilarity} ${
            pr.similarity === 'different' ? styles.prItemSimilarityDiff : ''
          }`}
        >
          {pr.similarity === 'identical'
            ? t.cluster.prList.similarity.identical
            : t.cluster.prList.similarity.different}
        </span>
      </div>
      <div className={styles.prItemTitle}>{pr.title}</div>
      <div className={styles.prItemMeta}>
        <span
          className={`${styles.prItemGaugeNum} ${
            pr.scoreTier === 'success'
              ? styles.prItemGaugeNumSuccess
              : pr.scoreTier === 'blue'
                ? styles.prItemGaugeNumBlue
                : ''
          }`}
        >
          {pr.score}
        </span>
        <span aria-hidden="true">·</span>
        <span>{pr.repo}</span>
      </div>
    </Link>
  );
}

function DiffRowItem({ row }: { row: ClusterDiffRowFixture }) {
  return (
    <div className={styles.diffRow}>
      <span className={styles.diffRowId}>{t.cluster.diff.idList(row.prNumbers)}</span>
      <div className={styles.diffRowBody}>
        <div className={styles.diffRowTitle}>{row.title}</div>
        <div className={styles.diffRowDetail}>
          {row.detailSegments.map((seg, i) =>
            seg.code ? (
              <code key={i}>{seg.text}</code>
            ) : seg.emphasis ? (
              <b key={i}>{seg.text}</b>
            ) : (
              <span key={i}>{seg.text}</span>
            ),
          )}
        </div>
      </div>
      <span className={`ds-tag ds-tag--md ${tagToneClass[row.flag.tone]} ${styles.diffRowFlag}`}>
        {row.flag.label}
      </span>
    </div>
  );
}

export default async function ClusterDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cluster = await getClusterDetail(id);
  if (!cluster) {
    notFound();
  }
  const identicalCount = cluster.prs.filter((p) => p.similarity === 'identical').length;

  return (
    <div className={styles.layout}>
      <aside className={styles.prList} aria-label={t.cluster.prList.ariaLabel}>
        <div className={styles.prListTitle}>{t.cluster.prList.title(cluster.prs.length)}</div>
        {cluster.prs.map((pr) => (
          <ClusterPRItemCard key={pr.id} pr={pr} />
        ))}
      </aside>

      <main className={styles.main}>
        <Link href="/inbox" className={styles.back}>
          <ChevronLeftIcon />
          {t.cluster.backToInbox}
        </Link>

        <header className={styles.header}>
          <div className={styles.headerTop}>
            <span className={styles.chip}>
              <ClusterIcon />
              {t.cluster.chip}
            </span>
            <span className={styles.headerSub}>{t.cluster.detectedAgo(cluster.detectedAgo)}</span>
          </div>
          <h1 className={styles.title}>{cluster.title}</h1>
          <p className={styles.description}>
            {cluster.descriptionSegments.map((seg, i) =>
              seg.code ? (
                <code key={i} className={styles.descriptionCode}>
                  {seg.text}
                </code>
              ) : (
                <span key={i}>{seg.text}</span>
              ),
            )}
          </p>
        </header>

        <section className={styles.infoCard}>
          <header className={styles.infoCardHead}>
            <span className={styles.infoCardTitle}>{t.cluster.info.title}</span>
            <span className={styles.infoCardSub}>
              {t.cluster.info.subtitle(cluster.prs.length, cluster.author, cluster.repo)}
            </span>
          </header>
          <div className={styles.infoStats}>
            <div className={styles.infoStat}>
              <div className={styles.infoStatLabel}>{t.cluster.info.avgScore}</div>
              <div className={`${styles.infoStatValue} ${styles.infoStatValueSuccess}`}>
                {cluster.summary.avgScore}
              </div>
            </div>
            <div className={styles.infoStat}>
              <div className={styles.infoStatLabel}>{t.cluster.info.totalAdditions}</div>
              <div className={styles.infoStatValue}>+{cluster.summary.totalAdditions}</div>
            </div>
            <div className={styles.infoStat}>
              <div className={styles.infoStatLabel}>{t.cluster.info.filesChanged}</div>
              <div className={styles.infoStatValue}>{cluster.summary.filesChanged}</div>
            </div>
            <div className={styles.infoStat}>
              <div className={styles.infoStatLabel}>{t.cluster.info.tests}</div>
              <div
                className={`${styles.infoStatValue} ${styles.infoStatValueSuccess} ${styles.infoStatText}`}
              >
                {t.cluster.info.testsAllPass}
              </div>
            </div>
          </div>
        </section>

        {cluster.pattern.lines.length > 0 && (
          <section className={styles.patternCard}>
            <header className={styles.patternCardHead}>
              <span className={styles.patternCardTitle}>
                {t.cluster.pattern.title(cluster.prs.length)}
              </span>
              <span className={styles.patternCardSub}>
                {t.cluster.pattern.example(cluster.pattern.sourceLabel)}
              </span>
            </header>
            <div className={styles.code}>
              {cluster.pattern.lines.map((line, i) => (
                <div key={i} className={`${styles.line} ${lineKindClass[line.kind]}`}>
                  <span className={styles.lineNum}>{line.lineNumber ?? ''}</span>
                  <span className={styles.lineSign}>{signFor(line.kind)}</span>
                  <span className={styles.lineText}>{line.text}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className={styles.diffCard}>
          <h2 className={styles.diffCardTitle}>{t.cluster.diff.title}</h2>
          {cluster.diffs.map((row) => (
            <DiffRowItem key={row.id} row={row} />
          ))}
        </section>
      </main>

      <aside className={styles.action} aria-label={t.cluster.action.ariaLabel}>
        <div className={styles.actionTitle}>{t.cluster.action.title}</div>

        <div className={styles.summaryStat}>
          <div className={styles.summaryStatNum}>{cluster.prs.length}</div>
          <div className={styles.summaryStatLabel}>{t.cluster.action.countLabel}</div>
          <div className={styles.summaryStatSub}>{t.cluster.action.timeNote}</div>
        </div>

        <div className={styles.actionActions}>
          <ClusterActions
            viewId={cluster.id}
            totalCount={cluster.prs.length}
            identicalCount={identicalCount}
            individualReviewNumber={cluster.individualReviewNumber}
          />
        </div>

        <div className={styles.actionNote}>
          <InfoIcon strokeWidth={2} />
          <div>
            <b>{cluster.decisionNote.highlight}</b> {cluster.decisionNote.rest}
          </div>
        </div>
      </aside>
    </div>
  );
}
