import { currentUser, favoriteProjects } from '@/lib/config';
import { getSidebarCounts } from '@/lib/inbox';
import { Sidebar } from './Sidebar';
import { WebhookListener } from './WebhookListener';
import styles from './AppShell.module.css';

export async function AppShell({ children }: { children: React.ReactNode }) {
  const counts = await getSidebarCounts();
  return (
    <div className={styles.app}>
      {/* webhook sync 가 일어날 때마다 SSE 로 push → router.refresh() — 폴링 없이 실시간. */}
      <WebhookListener />
      <Sidebar counts={counts} user={currentUser} favoriteProjects={favoriteProjects} />
      <main className={styles.main}>{children}</main>
    </div>
  );
}
