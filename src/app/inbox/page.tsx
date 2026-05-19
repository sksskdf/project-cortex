import Link from 'next/link';
import { ko as t } from '@/copy/ko';
import { PRRow } from '@/components/PRRow';
import { BellIcon, ClusterIcon } from '@/components/icons';
import {
  getInboxCategories,
  getInboxClusterBanner,
  getInboxProjects,
  listInboxQueue,
  type InboxCategoryId,
  type InboxProject,
} from '@/lib/inbox';
import styles from './page.module.css';

const categoryLabel: Record<InboxCategoryId, string> = {
  all: t.inbox.rail.all,
  flagged: t.inbox.rail.flagged,
  large: t.inbox.rail.largeChange,
  migration: t.inbox.rail.migration,
  cluster: t.inbox.rail.cluster,
  mentioned: t.inbox.rail.mentioned,
};

const projectDotClass: Record<InboxProject['dot'], string> = {
  blue: styles.projectDotBlue,
  green: styles.projectDotGreen,
  yellow: styles.projectDotYellow,
};

const sortTabs = [
  { id: 'priority', label: t.inbox.sort.priority, active: true },
  { id: 'confidence', label: t.inbox.sort.confidence, active: false },
  { id: 'latest', label: t.inbox.sort.latest, active: false },
  { id: 'author', label: t.inbox.sort.author, active: false },
] as const;

// 인박스 카테고리 아이콘 — 카테고리 6종에만 쓰이므로 이 파일에 남김.
function categoryIcon(id: InboxCategoryId) {
  switch (id) {
    case 'all':
      return (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M22 12h-6l-2 3h-4l-2-3H2" />
          <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
        </svg>
      );
    case 'flagged':
      return (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1={12} y1={9} x2={12} y2={13} />
          <line x1={12} y1={17} x2={12.01} y2={17} />
        </svg>
      );
    case 'large':
      return (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
          <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
        </svg>
      );
    case 'migration':
      return (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <ellipse cx={12} cy={5} rx={9} ry={3} />
          <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
          <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
        </svg>
      );
    case 'cluster':
      return <ClusterIcon />;
    case 'mentioned':
      return (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
      );
  }
}

function searchIcon() {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx={11} cy={11} r={7} />
      <line x1={16.65} y1={16.65} x2={21} y2={21} />
    </svg>
  );
}

export default async function InboxPage() {
  const [inboxQueue, inboxCategories, inboxProjects, inboxClusterBanner] = await Promise.all([
    listInboxQueue(),
    getInboxCategories(),
    getInboxProjects(),
    getInboxClusterBanner(),
  ]);

  return (
    <div className={styles.layout}>
      <nav className={styles.rail} aria-label={t.inbox.rail.ariaLabel}>
        <div className={styles.railTitle}>{t.inbox.rail.categoryTitle}</div>
        <ul className={styles.railList}>
          {inboxCategories.map((cat, i) => (
            <li key={cat.id}>
              <Link
                href="/inbox"
                className={`${styles.railItem} ${i === 0 ? styles.railItemActive : ''}`}
              >
                {categoryIcon(cat.id)}
                <span className={styles.railLabel}>{categoryLabel[cat.id]}</span>
                <span className={styles.railCount}>{cat.count}</span>
              </Link>
            </li>
          ))}
        </ul>

        <div className={`${styles.railTitle} ${styles.railTitleProjects}`}>
          {t.inbox.rail.projectTitle}
        </div>
        <ul className={styles.railList}>
          {inboxProjects.map((project) => (
            <li key={project.id}>
              <Link href={`/projects/${project.id}`} className={styles.railItem}>
                <span
                  className={`${styles.projectDot} ${projectDotClass[project.dot]}`}
                  aria-hidden="true"
                />
                <span className={styles.railLabel}>{project.name}</span>
                <span className={styles.railCount}>{project.count}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <main className={styles.content}>
        <div className={styles.header}>
          <div className={styles.titleWrap}>
            <h1 className={styles.title}>{t.inbox.title}</h1>
            <span className={styles.sub}>{t.inbox.subtitle}</span>
          </div>
          <div className={styles.actions}>
            <button type="button" className={styles.iconBtn} aria-label={t.inbox.notifications}>
              <BellIcon />
              <span className={`ds-badge ds-badge--pill ${styles.iconBtnBadge}`}>3</span>
            </button>
            <button type="button" className="ds-btn ds-btn--md ds-btn--outlined-basic">
              <span className="ds-btn__label">{t.inbox.filter}</span>
            </button>
          </div>
        </div>

        <div className={styles.toolbar}>
          <div className="ds-segment" role="tablist" aria-label={t.inbox.sort.ariaLabel}>
            {sortTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={tab.active}
                className={`ds-segment__item ${tab.active ? 'ds-segment__item--active' : ''}`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className={styles.toolbarSearch}>
            <div className="ds-input ds-input--md ds-input--full-width ds-input--with-icon">
              <input
                className="ds-input__field"
                type="text"
                placeholder={t.inbox.search.placeholder}
                aria-label={t.inbox.search.ariaLabel}
              />
              <span className="ds-input__icon" aria-hidden="true">
                {searchIcon()}
              </span>
            </div>
          </div>
        </div>

        {inboxClusterBanner && (
          <Link href={`/cluster/${inboxClusterBanner.id}`} className={styles.clusterBanner}>
            <div className={styles.clusterBannerIcon} aria-hidden="true">
              <ClusterIcon />
            </div>
            <div className={styles.clusterBannerBody}>
              <div className={styles.clusterBannerTitle}>{inboxClusterBanner.title}</div>
              <div className={styles.clusterBannerSub}>{inboxClusterBanner.description}</div>
            </div>
            <span className="ds-btn ds-btn--md ds-btn--filled-blue">
              <span className="ds-btn__label">{t.inbox.clusterBanner.open}</span>
            </span>
          </Link>
        )}

        <div className={styles.queue}>
          {inboxQueue.map((pr) => (
            <PRRow key={pr.id} pr={pr} selectable />
          ))}
        </div>
      </main>
    </div>
  );
}
