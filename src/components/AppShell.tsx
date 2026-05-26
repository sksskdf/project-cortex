import { currentUser } from '@/lib/config';
import { getSidebarCounts } from '@/lib/inbox';
import { isClaudeAvailable } from '@/lib/agents';
import { listWorkspaces } from '@/lib/workspace';
import { AgentDrawerProvider } from './AgentDrawer';
import { Sidebar } from './Sidebar';
import { WebhookListener } from './WebhookListener';
import styles from './AppShell.module.css';

export async function AppShell({ children }: { children: React.ReactNode }) {
  const counts = await getSidebarCounts();
  // 전역 에이전트 드로어용 — 레이아웃에 마운트되어 화면 이동에도 세션 유지.
  const workspaces = listWorkspaces().map((w) => ({
    id: w.id,
    projectSlug: w.projectSlug,
    localPath: w.localPath,
  }));
  const claudeReady = isClaudeAvailable();

  return (
    <AgentDrawerProvider workspaces={workspaces} claudeReady={claudeReady}>
      <div className={styles.app}>
        {/* webhook sync 가 일어날 때마다 SSE 로 push → router.refresh() — 폴링 없이 실시간. */}
        <WebhookListener />
        <Sidebar counts={counts} user={currentUser} />
        <main className={styles.main}>{children}</main>
      </div>
    </AgentDrawerProvider>
  );
}
