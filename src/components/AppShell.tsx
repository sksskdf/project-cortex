import { currentUser, favoriteProjects } from '@/lib/config';
import { getSidebarCounts } from '@/lib/inbox';
import { Sidebar } from './Sidebar';
import styles from './AppShell.module.css';

export async function AppShell({ children }: { children: React.ReactNode }) {
  const counts = await getSidebarCounts();
  return (
    <div className={styles.app}>
      <Sidebar counts={counts} user={currentUser} favoriteProjects={favoriteProjects} />
      <main className={styles.main}>{children}</main>
    </div>
  );
}
