import { Sidebar } from './Sidebar';
import styles from './AppShell.module.css';

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.app}>
      <Sidebar />
      <main className={styles.main}>{children}</main>
    </div>
  );
}
