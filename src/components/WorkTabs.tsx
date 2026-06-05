'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ko as t } from '@/copy/ko';
import styles from './WorkTabs.module.css';

// Phase 18 통합 IA — '작업' 허브 하위 탭. 사이드바에 이슈/TODO 를 따로 두지 않고
// 작업 허브(/work·/issues·/todos) 안에서 전환한다. active 는 pathname 기준.
type Tab = { href: string; label: string; count?: number };

export function WorkTabs({ issues, todos }: { issues: number; todos: number }) {
  const pathname = usePathname();
  const tabs: ReadonlyArray<Tab> = [
    { href: '/work', label: t.work.tabs.flow },
    { href: '/issues', label: t.work.tabs.issues, count: issues },
    { href: '/todos', label: t.work.tabs.todos, count: todos },
  ];

  return (
    <nav className={styles.tabs} aria-label={t.work.tabs.ariaLabel}>
      {tabs.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`${styles.tab} ${active ? styles.tabActive : ''}`}
            aria-current={active ? 'page' : undefined}
          >
            <span>{tab.label}</span>
            {tab.count !== undefined && tab.count > 0 && (
              <span className={styles.count}>{tab.count}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
