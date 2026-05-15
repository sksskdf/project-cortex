'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ko as t } from '@/copy/ko';
import { currentUser, favoriteProjects, sidebarCounts } from '@/mocks/dashboard';
import styles from './Sidebar.module.css';

type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
  count?: number;
  countAlert?: boolean;
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

const agentsIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx={12} cy={12} r={3} />
    <path d="M12 1v6m0 10v6m11-11h-6M7 12H1m15.36-7.36-4.24 4.24m-4.24 4.24-4.24 4.24m12.72 0-4.24-4.24M7.76 7.76 3.52 3.52" />
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

const chevronIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <li>
      <Link href={item.href} className={`${styles.item} ${active ? styles.itemActive : ''}`}>
        {item.icon}
        <span className={styles.itemLabel}>{item.label}</span>
        {item.count !== undefined && (
          <span className={`${styles.itemCount} ${item.countAlert ? styles.itemCountAlert : ''}`}>
            {item.count}
          </span>
        )}
      </Link>
    </li>
  );
}

export function Sidebar() {
  const pathname = usePathname();

  const mainItems: ReadonlyArray<NavItem> = [
    { href: '/', label: t.nav.dashboard, icon: dashboardIcon },
    {
      href: '/inbox',
      label: t.nav.inbox,
      icon: inboxIcon,
      count: sidebarCounts.inbox,
      countAlert: true,
    },
    { href: '/projects', label: t.nav.projects, icon: projectsIcon, count: sidebarCounts.projects },
    { href: '/agents', label: t.nav.agents, icon: agentsIcon, count: sidebarCounts.agents },
    {
      href: '/clusters',
      label: t.nav.clusters,
      icon: clustersIcon,
      count: sidebarCounts.clusters,
    },
    { href: '/reports', label: t.nav.reports, icon: reportsIcon },
  ];

  const utilityItems: ReadonlyArray<NavItem> = [
    { href: '/settings', label: t.nav.settings, icon: settingsIcon },
    { href: '/help', label: t.nav.help, icon: helpIcon },
  ];

  return (
    <aside className={styles.sidebar} aria-label={t.nav.section.workspace}>
      <div className={styles.brand}>
        <span className={styles.brandMark} aria-hidden="true" />
        {t.app.name}
      </div>

      <nav className={styles.section} aria-label={t.nav.section.workspace}>
        <div className={styles.sectionTitle}>{t.nav.section.workspace}</div>
        <ul className={styles.list}>
          {mainItems.map((item) => (
            <NavLink key={item.href} item={item} active={isActive(pathname, item.href)} />
          ))}
        </ul>
      </nav>

      <nav className={styles.section} aria-label={t.nav.section.favorites}>
        <div className={styles.sectionTitle}>{t.nav.section.favorites}</div>
        <ul className={styles.list}>
          {favoriteProjects.map((name) => (
            <li key={name}>
              <Link href={`/projects/${name}`} className={styles.item}>
                {chevronIcon}
                <span className={styles.itemLabel}>{name}</span>
              </Link>
            </li>
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
            {currentUser.initials}
          </span>
          <div>
            <div className={styles.userName}>{currentUser.name}</div>
            <div className={styles.userRole}>{currentUser.role}</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
