'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ko as t } from '@/copy/ko';
import type { CurrentUser, SidebarCounts } from '@/lib/types';
import { useHelp } from './HelpOverlay';
import styles from './Sidebar.module.css';

type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
  count?: number;
  countAlert?: boolean;
  // 라우트가 아직 없을 때 — 클릭 비활성, "준비 중" 표시.
  // 해당 Phase 가 들어오면 false 로 바꾼다.
  comingSoon?: boolean;
  // 라우트 이동 대신 액션 (예: '에이전트' → 전역 드로어 열기). 있으면 button 으로 렌더.
  onSelect?: () => void;
};

const dashboardIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 3h18v18H3z" />
    <path d="M3 9h18M9 21V9" />
  </svg>
);

const inboxIcon = (
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

const projectsIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x={3} y={4} width={18} height={16} rx={2} />
    <line x1={3} y1={9} x2={21} y2={9} />
  </svg>
);

const issuesIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx={12} cy={12} r={9} />
    <line x1={12} y1={8} x2={12} y2={12} />
    <line x1={12} y1={16} x2={12.01} y2={16} />
  </svg>
);

const todosIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="9 11 12 14 22 4" />
    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
  </svg>
);

const notesIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="9" y1="13" x2="15" y2="13" />
    <line x1="9" y1="17" x2="13" y2="17" />
  </svg>
);

const clustersIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx={6} cy={6} r={3} />
    <circle cx={18} cy={6} r={3} />
    <circle cx={12} cy={18} r={3} />
    <path d="M9 8l3 8m3-8l-3 8" />
  </svg>
);

const reportsIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1={4} y1={20} x2={4} y2={10} />
    <line x1={12} y1={20} x2={12} y2={4} />
    <line x1={20} y1={20} x2={20} y2={14} />
  </svg>
);

const settingsIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx={12} cy={12} r={3} />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33" />
  </svg>
);

const helpIcon = (
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

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const className = `${styles.item} ${active ? styles.itemActive : ''} ${item.comingSoon ? styles.itemDisabled : ''}`;
  const body = (
    <>
      {item.icon}
      <span className={styles.itemLabel}>{item.label}</span>
      {item.comingSoon ? (
        <span className={styles.itemSoon}>{t.nav.comingSoon}</span>
      ) : item.count !== undefined ? (
        <span className={`${styles.itemCount} ${item.countAlert ? styles.itemCountAlert : ''}`}>
          {item.count}
        </span>
      ) : null}
    </>
  );

  if (item.comingSoon) {
    // 라우트가 없으니 a/Link 가 아닌 span — 404 회피.
    return (
      <li>
        <span className={className} aria-disabled="true">
          {body}
        </span>
      </li>
    );
  }

  // 라우트 이동 대신 액션 (전역 드로어 열기 등) — button 으로 렌더.
  if (item.onSelect) {
    return (
      <li>
        <button
          type="button"
          className={`${className} ${styles.itemButton}`}
          onClick={item.onSelect}
        >
          {body}
        </button>
      </li>
    );
  }

  return (
    <li>
      <Link href={item.href} className={className}>
        {body}
      </Link>
    </li>
  );
}

export function Sidebar({ counts, user }: { counts: SidebarCounts; user: CurrentUser }) {
  const pathname = usePathname();
  const { openHelp } = useHelp();

  // comingSoon: 라우트가 아직 없는 항목들. 해당 Phase 진입 시 false 로 전환.
  // /clusters: Phase 6 — 활성. /projects: Phase 8 — 활성.
  // 에이전트는 사이드바 항목 제거 — 우하단 런처로 드로어를 연다.
  // /reports: Phase 7 — 활성. /help: Phase 14 — 라우트 이동 대신 도움말 오버레이 (onSelect).
  const mainItems: ReadonlyArray<NavItem> = [
    { href: '/', label: t.nav.dashboard, icon: dashboardIcon },
    {
      href: '/inbox',
      label: t.nav.inbox,
      icon: inboxIcon,
      count: counts.inbox,
      countAlert: true,
    },
    {
      href: '/projects',
      label: t.nav.projects,
      icon: projectsIcon,
      count: counts.projects,
      comingSoon: false,
    },
    {
      href: '/issues',
      label: t.nav.issues,
      icon: issuesIcon,
      count: counts.issues,
    },
    {
      href: '/todos',
      label: t.nav.todos,
      icon: todosIcon,
      count: counts.todos,
    },
    {
      href: '/notes',
      label: t.nav.notes,
      icon: notesIcon,
      count: counts.notes,
    },
    {
      href: '/clusters',
      label: t.nav.clusters,
      icon: clustersIcon,
      count: counts.clusters,
    },
    { href: '/reports', label: t.nav.reports, icon: reportsIcon },
  ];

  const utilityItems: ReadonlyArray<NavItem> = [
    { href: '/settings', label: t.nav.settings, icon: settingsIcon },
    // 라우트가 아니라 현재 화면 위 오버레이 — '?' 단축키와 동일.
    { href: '/help', label: t.nav.help, icon: helpIcon, onSelect: openHelp },
  ];

  return (
    <aside className={styles.sidebar} aria-label={t.nav.section.workspace}>
      <nav className={styles.section} aria-label={t.nav.section.workspace}>
        <div className={styles.sectionTitle}>{t.nav.section.workspace}</div>
        <ul className={styles.list}>
          {mainItems.map((item) => (
            <NavLink key={item.href} item={item} active={isActive(pathname, item.href)} />
          ))}
        </ul>
      </nav>

      <div className={styles.divider} />

      <nav className={styles.section}>
        <ul className={styles.list}>
          {utilityItems.map((item) => (
            <NavLink key={item.href} item={item} active={isActive(pathname, item.href)} />
          ))}
        </ul>
      </nav>

      <div className={styles.footer}>
        <div className={styles.user}>
          <span className={styles.avatar} aria-hidden="true">
            {user.initials}
          </span>
          <div>
            <div className={styles.userName}>{user.name}</div>
            <div className={styles.userRole}>{user.role}</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
