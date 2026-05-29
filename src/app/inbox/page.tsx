import Link from 'next/link';
import { ko as t } from '@/copy/ko';
import { InboxRows } from '@/components/InboxRows';
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
  done: t.inbox.rail.done,
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
    case 'done':
      return (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
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

// 인박스 필터 링크 — category(all 은 생략) · project 슬러그를 쿼리로 합성, 둘은 AND 조합.
// cluster 카테고리만 예외로 /clusters 목록으로 navigate (호출부에서 분기).
function inboxHref(params: { category?: InboxCategoryId; project?: string }): string {
  const sp = new URLSearchParams();
  if (params.category && params.category !== 'all') sp.set('category', params.category);
  if (params.project) sp.set('project', params.project);
  const qs = sp.toString();
  return qs ? `/inbox?${qs}` : '/inbox';
}

const FILTERABLE_CATEGORIES: ReadonlyArray<InboxCategoryId> = [
  'all',
  'flagged',
  'large',
  'migration',
  'mentioned',
  'done',
];

function parseCategory(raw: string | string[] | undefined): InboxCategoryId {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && (FILTERABLE_CATEGORIES as ReadonlyArray<string>).includes(value)
    ? (value as InboxCategoryId)
    : 'all';
}

function parseSearch(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (value ?? '').slice(0, 100);
}

function parseProject(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (value ?? '').slice(0, 100);
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{
    category?: string | string[];
    q?: string | string[];
    project?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const activeCategory = parseCategory(params.category);
  const searchQuery = parseSearch(params.q);
  const activeProject = parseProject(params.project);

  const [inboxQueue, inboxCategories, inboxProjects, inboxClusterBanner] = await Promise.all([
    listInboxQueue(activeCategory, searchQuery, activeProject),
    getInboxCategories(),
    getInboxProjects(),
    getInboxClusterBanner(),
  ]);

  return (
    <div className={styles.layout}>
      <nav className={styles.rail} aria-label={t.inbox.rail.ariaLabel}>
        <div className={styles.railTitle}>{t.inbox.rail.categoryTitle}</div>
        <ul className={styles.railList}>
          {inboxCategories.map((cat) => {
            // cluster 만 /clusters 로 이탈, 나머지는 현재 project 필터를 유지하며 category 전환.
            const href =
              cat.id === 'cluster'
                ? '/clusters'
                : inboxHref({ category: cat.id, project: activeProject });
            const isActive = cat.id === activeCategory;
            return (
              <li key={cat.id}>
                <Link
                  href={href}
                  className={`${styles.railItem} ${isActive ? styles.railItemActive : ''}`}
                >
                  {categoryIcon(cat.id)}
                  <span className={styles.railLabel}>{categoryLabel[cat.id]}</span>
                  <span className={styles.railCount}>{cat.count}</span>
                </Link>
              </li>
            );
          })}
        </ul>

        <div className={`${styles.railTitle} ${styles.railTitleProjects}`}>
          {t.inbox.rail.projectTitle}
        </div>
        <ul className={styles.railList}>
          {inboxProjects.map((project) => {
            const isActive = project.id === activeProject;
            // 활성 프로젝트를 다시 클릭하면 필터 해제(project 제거). category 는 유지.
            const href = inboxHref({
              category: activeCategory,
              project: isActive ? undefined : project.id,
            });
            return (
              <li key={project.id}>
                <Link
                  href={href}
                  className={`${styles.railItem} ${isActive ? styles.railItemActive : ''}`}
                >
                  <span
                    className={`${styles.projectDot} ${projectDotClass[project.dot]}`}
                    aria-hidden="true"
                  />
                  <span className={styles.railLabel}>{project.name}</span>
                  <span className={styles.railCount}>{project.count}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <main className={styles.content}>
        <div className={styles.header}>
          <div className={styles.titleWrap}>
            <h1 className={styles.title}>{t.inbox.title}</h1>
            <span className={styles.sub}>{t.inbox.subtitle}</span>
          </div>
          <div className={styles.actions}>
            {/* 알림 · 필터는 백엔드 미구현 — disabled. 사유를 title/aria 로 안내. */}
            <button
              type="button"
              className={styles.iconBtn}
              aria-label={t.inbox.notificationsHint}
              title={t.inbox.notificationsHint}
              disabled
            >
              <BellIcon />
            </button>
            <button
              type="button"
              className="ds-btn ds-btn--md ds-btn--outlined-basic"
              disabled
              aria-disabled="true"
              aria-label={t.inbox.filterHint}
              title={t.inbox.filterHint}
            >
              <span className="ds-btn__label">{t.inbox.filter}</span>
              <span className={styles.comingSoonBadge}>{t.nav.comingSoon}</span>
            </button>
          </div>
        </div>

        <div className={styles.toolbar}>
          {/* 정렬은 현재 priority(orderInbox) 만 구현 — 나머지 탭은 disabled.
              사유를 title/aria-label 로 안내해 "눌렀는데 반응 없음" 을 방지. */}
          <div className="ds-segment" role="tablist" aria-label={t.inbox.sort.ariaLabel}>
            {sortTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={tab.active}
                disabled={!tab.active}
                aria-disabled={!tab.active}
                title={tab.active ? undefined : t.inbox.sort.comingSoonHint}
                aria-label={
                  tab.active ? undefined : `${tab.label} — ${t.inbox.sort.comingSoonHint}`
                }
                className={`ds-segment__item ${tab.active ? 'ds-segment__item--active' : ''}`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {/* GET form 으로 ?q= 쿼리 전송 → SSR 이 그대로 받아 SQL LIKE 적용.
              JS 없이 동작하고 URL 공유 가능. category 는 hidden 으로 유지. */}
          <form className={styles.toolbarSearch} method="get" action="/inbox" role="search">
            {activeCategory !== 'all' && (
              <input type="hidden" name="category" value={activeCategory} />
            )}
            {activeProject && <input type="hidden" name="project" value={activeProject} />}
            <div className="ds-input ds-input--md ds-input--full-width ds-input--with-icon">
              <input
                className="ds-input__field"
                type="text"
                name="q"
                placeholder={t.inbox.search.placeholder}
                aria-label={t.inbox.search.ariaLabel}
                defaultValue={searchQuery}
              />
              <span className="ds-input__icon" aria-hidden="true">
                {searchIcon()}
              </span>
            </div>
          </form>
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
          <InboxRows rows={inboxQueue} />
        </div>
      </main>
    </div>
  );
}
