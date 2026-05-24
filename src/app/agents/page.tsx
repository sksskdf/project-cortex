// Phase 13 — /agents 페이지. 등록된 워크스페이스에서 Claude Code CLI 를 실행하는 터미널 콘솔.
// 사이드바 "에이전트" 활성화. spawn 은 커스텀 서버의 node-pty 가 처리 (src/server/pty.ts).

import Link from 'next/link';
import { ko as t } from '@/copy/ko';
import { AgentConsole, type WorkspaceOption } from '@/components/AgentConsole';
import { isClaudeAvailable } from '@/lib/agents';
import { listWorkspaces } from '@/lib/workspace';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

export default function AgentsPage() {
  const options: WorkspaceOption[] = listWorkspaces().map((w) => ({
    id: w.id,
    projectSlug: w.projectSlug,
    localPath: w.localPath,
  }));
  const claudeReady = isClaudeAvailable();

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerText}>
          <h1 className={styles.title}>{t.agents.title}</h1>
          <p className={styles.subtitle}>{t.agents.subtitle}</p>
        </div>
      </header>

      {options.length === 0 ? (
        <div className={styles.empty}>
          <strong>{t.agents.empty.title}</strong>
          <p>{t.agents.empty.desc}</p>
          <Link className="ds-btn ds-btn--sm ds-btn--outlined-basic" href="/projects">
            <span className="ds-btn__label">{t.agents.empty.cta}</span>
          </Link>
        </div>
      ) : (
        <AgentConsole workspaces={options} claudeReady={claudeReady} />
      )}
    </div>
  );
}
