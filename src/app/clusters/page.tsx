import Link from 'next/link';
import { ko as t } from '@/copy/ko';
import { listAllClusters, type ClusterListItem } from '@/lib/clusters';
import styles from './page.module.css';

const statusClass: Record<ClusterListItem['status'], string> = {
  open: styles.status,
  'partially-merged': `${styles.status} ${styles.statusPartial}`,
  merged: `${styles.status} ${styles.statusMerged}`,
  dissolved: `${styles.status} ${styles.statusDissolved}`,
};

function ClusterCard({ item }: { item: ClusterListItem }) {
  const isClosed = item.group === 'closed';
  return (
    <Link
      href={`/cluster/${item.id}`}
      className={`${styles.card} ${isClosed ? styles.cardClosed : ''}`}
    >
      <div className={styles.cardHead}>
        <span className={statusClass[item.status]}>{t.clustersIndex.statusLabel[item.status]}</span>
        <span className={styles.cardTime}>
          {isClosed && item.closedAgo
            ? t.clustersIndex.card.closedAgo(item.closedAgo)
            : t.clustersIndex.card.detectedAgo(item.detectedAgo)}
        </span>
      </div>
      <div className={styles.cardTitle}>{item.title}</div>
      <div className={styles.cardMeta}>
        {t.clustersIndex.card.meta(item.prCount, item.author || '—', item.repo || '—')}
      </div>
      <div className={styles.cardStats}>
        <span className={styles.score}>{item.avgScore}</span>
        <span className={styles.scoreLabel}>{t.clustersIndex.card.score}</span>
      </div>
    </Link>
  );
}

export default async function ClustersIndexPage() {
  const all = await listAllClusters();
  const active = all.filter((c) => c.group === 'active');
  const closed = all.filter((c) => c.group === 'closed');

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t.clustersIndex.title}</h1>
        <p className={styles.subtitle}>{t.clustersIndex.subtitle}</p>
      </header>

      <section className={styles.section} aria-label={t.clustersIndex.section.active}>
        <h2 className={styles.sectionTitle}>{t.clustersIndex.section.active}</h2>
        {active.length === 0 ? (
          <div className={styles.empty}>{t.clustersIndex.empty.active}</div>
        ) : (
          <div className={styles.grid}>
            {active.map((c) => (
              <ClusterCard key={c.id} item={c} />
            ))}
          </div>
        )}
      </section>

      <section className={styles.section} aria-label={t.clustersIndex.section.closed}>
        <h2 className={styles.sectionTitle}>{t.clustersIndex.section.closed}</h2>
        {closed.length === 0 ? (
          <div className={styles.empty}>{t.clustersIndex.empty.closed}</div>
        ) : (
          <div className={styles.grid}>
            {closed.map((c) => (
              <ClusterCard key={c.id} item={c} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
