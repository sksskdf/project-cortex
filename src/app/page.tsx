import Link from 'next/link';
import { ko as t } from '@/copy/ko';
import { CheckIcon } from '@/components/icons';
import { NewIssueDialog } from '@/components/NewIssueDialog';
import { NotificationDropdown } from '@/components/NotificationDropdown';
import { agentWorkloads, type AgentWorkload } from '@/fixtures/dashboard';
import { currentUser } from '@/lib/config';
import {
  getDashboardClusters,
  getDashboardStats,
  getRecentMerges,
  getTodayRows,
} from '@/lib/dashboard';
import { DashboardNotesWidget } from '@/components/DashboardNotesWidget';
import { DashboardProjectsWidget } from '@/components/DashboardProjectsWidget';
import { DashboardTodosWidget } from '@/components/DashboardTodosWidget';
import { RecentMergesFeed } from '@/components/RecentMergesFeed';
import { MarkAllReadButton } from '@/components/MarkAllReadButton';
import { OpenAgentDrawerButton } from '@/components/OpenAgentDrawerButton';
import { TodayRows } from '@/components/TodayRows';
import { LiveStatusStrip } from '@/components/LiveStatusStrip';
import { getLiveStatus } from '@/lib/live-status';
import { listPinnedNotes } from '@/lib/notes';
import { listRecentNotifications, unreadNotificationCount } from '@/lib/notifications';
import { unreadMergedCount } from '@/lib/pr-read';
import { listIssueRepos } from '@/lib/issues';
import { listDashboardProjects } from '@/lib/roadmap';
import { listTodos } from '@/lib/todos';
import type { StatDelta } from '@/lib/types';
import styles from './page.module.css';

type WorkloadBarTone = AgentWorkload['bar'];

const workloadBarClass: Record<WorkloadBarTone, string> = {
  blue: styles.workloadBar,
  green: `${styles.workloadBar} ${styles.workloadBarGreen}`,
  yellow: `${styles.workloadBar} ${styles.workloadBarYellow}`,
};

function inboxStatIcon() {
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
}

function boltIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

function pinIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z" />
      <circle cx={12} cy={10} r={3} />
    </svg>
  );
}

function deltaUpIcon() {
  return (
    <svg
      width={10}
      height={10}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="6 15 12 9 18 15" />
    </svg>
  );
}

function deltaDownIcon() {
  return (
    <svg
      width={10}
      height={10}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function runningDotIcon() {
  return (
    <svg
      width={10}
      height={10}
      viewBox="0 0 24 24"
      fill="var(--ds-color-state-success-accent)"
      stroke="none"
    >
      <circle cx={12} cy={12} r={6} />
    </svg>
  );
}

function DeltaBadge({ delta }: { delta: StatDelta }) {
  const className =
    delta.direction === 'up'
      ? `${styles.statDelta} ${styles.statDeltaUp}`
      : delta.direction === 'down'
        ? `${styles.statDelta} ${styles.statDeltaDown}`
        : `${styles.statDelta} ${styles.statDeltaFlat}`;
  const sign = delta.direction === 'down' ? '−' : '+';
  return (
    <span className={className}>
      {delta.direction === 'down' ? deltaDownIcon() : deltaUpIcon()}
      {sign}
      {delta.amount} {delta.comparedTo}
    </span>
  );
}

function WorkloadCard({ rows }: { rows: ReadonlyArray<AgentWorkload> }) {
  if (rows.length === 0) {
    // agent_runs 데이터 없는 상태 — Phase 8 onboarding 이후 채워짐.
    return (
      <div className={styles.workloadCard}>
        <div className={styles.workloadEmpty}>{t.dashboard.workload.empty}</div>
      </div>
    );
  }
  return (
    <div className={styles.workloadCard}>
      <div className={styles.workload}>
        {rows.map((row) => {
          const pct = Math.round((row.current / row.capacity) * 100);
          return (
            <div key={row.name} className={styles.workloadRow}>
              <div className={styles.workloadHead}>
                <span className={styles.workloadName}>{row.name}</span>
                <span className={styles.workloadCount}>
                  {t.dashboard.workload.count(row.current, row.capacity)}
                </span>
              </div>
              <div className={styles.workloadBarTrack}>
                <div className={workloadBarClass[row.bar]} style={{ width: `${pct}%` }} />
              </div>
              <span className={styles.workloadEta}>{row.eta}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default async function DashboardPage() {
  const [dashboardStats, todoRows, recentMerges, dashboardClusters] = await Promise.all([
    getDashboardStats(),
    getTodayRows(3),
    // 행은 5개만 보여주되(displayLimit), 모달 앞뒤 넘김은 더 많은 머지를 순회할 수 있도록
    // 넉넉히 로드("5개 제한 풀기"). 라이트 요약이라 200건 로드도 가볍다.
    getRecentMerges(200),
    getDashboardClusters(),
  ]);
  const notifications = listRecentNotifications();
  const unreadCount = unreadNotificationCount();
  const unreadMerges = unreadMergedCount();
  const liveStatus = getLiveStatus();
  const dashboardProjects = listDashboardProjects();
  const dashboardTodos = listTodos('open');
  const dashboardPinnedNotes = listPinnedNotes();
  const issueRepos = listIssueRepos();
  const todayReviewCount = dashboardStats.pendingReview.value;
  const weekAutoMergedCount = dashboardStats.autoMergedThisWeek.value;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.greeting}>{t.dashboard.greeting(currentUser.name)}</h1>
          <p className={styles.greetingSub}>{t.dashboard.greetingSub(todayReviewCount)}</p>
        </div>
        <div className={styles.headerActions}>
          {/* 알림은 Phase 7 활성화 — NotificationDropdown 가 자체 BellIcon + 카운트 배지 렌더.
              새 이슈는 NewIssueDialog 모달 — Claude Code 위임 토글 포함 (Phase 13). */}
          <NotificationDropdown notifications={notifications} unreadCount={unreadCount} />
          <NewIssueDialog repos={issueRepos} />
        </div>
      </header>

      <div className={styles.principle} role="note">
        <div className={styles.principleIcon} aria-hidden="true">
          <CheckIcon strokeWidth={2} />
        </div>
        <div>
          <div className={styles.principleTitle}>
            {t.dashboard.principle.title(weekAutoMergedCount)}
          </div>
          <div className={styles.principleDesc}>{t.dashboard.principle.desc}</div>
        </div>
      </div>

      <LiveStatusStrip status={liveStatus} />

      <section className={styles.statGrid} aria-label={t.dashboard.stat.regionAria}>
        <div className={styles.stat}>
          <div className={styles.statTop}>
            <span className={`${styles.statIcon} ${styles.statIconBlue}`} aria-hidden="true">
              {inboxStatIcon()}
            </span>
          </div>
          <div className={styles.statLabel}>{t.dashboard.stat.pendingReview}</div>
          <div className={styles.statValue}>{dashboardStats.pendingReview.value}</div>
          <DeltaBadge delta={dashboardStats.pendingReview.delta} />
        </div>

        <div className={styles.stat}>
          <div className={styles.statTop}>
            <span className={`${styles.statIcon} ${styles.statIconGreen}`} aria-hidden="true">
              <CheckIcon strokeWidth={2} />
            </span>
          </div>
          <div className={styles.statLabel}>{t.dashboard.stat.autoMergedThisWeek}</div>
          <div className={styles.statValue}>{dashboardStats.autoMergedThisWeek.value}</div>
          <DeltaBadge delta={dashboardStats.autoMergedThisWeek.delta} />
        </div>

        <div className={styles.stat}>
          <div className={styles.statTop}>
            <span className={`${styles.statIcon} ${styles.statIconYellow}`} aria-hidden="true">
              <CheckIcon strokeWidth={2} />
            </span>
          </div>
          <div className={styles.statLabel}>{t.dashboard.stat.humanMergedThisWeek}</div>
          <div className={styles.statValue}>{dashboardStats.humanMergedThisWeek.value}</div>
          <DeltaBadge delta={dashboardStats.humanMergedThisWeek.delta} />
        </div>

        <div className={styles.stat}>
          <div className={styles.statTop}>
            <span className={`${styles.statIcon} ${styles.statIconYellow}`} aria-hidden="true">
              {boltIcon()}
            </span>
          </div>
          <div className={styles.statLabel}>{t.dashboard.stat.agentsRunning}</div>
          <div className={styles.statValue}>{dashboardStats.agentsRunning.value}</div>
          {dashboardStats.agentsRunning.value > 0 ? (
            <span className={`${styles.statDelta} ${styles.statDeltaFlat}`}>
              {runningDotIcon()}
              {t.dashboard.stat.runningNow}
            </span>
          ) : (
            <span className={`${styles.statDelta} ${styles.statDeltaFlat}`}>
              {t.dashboard.stat.runningIdle}
            </span>
          )}
        </div>

        <div className={styles.stat}>
          <div className={styles.statTop}>
            <span className={`${styles.statIcon} ${styles.statIconPurple}`} aria-hidden="true">
              {pinIcon()}
            </span>
          </div>
          <div className={styles.statLabel}>{t.dashboard.stat.avgConfidence}</div>
          <div className={styles.statValue}>
            {dashboardStats.avgConfidence.value}
            <span className={styles.statValueUnit}>{t.dashboard.stat.scoreUnit}</span>
          </div>
          <DeltaBadge delta={dashboardStats.avgConfidence.delta} />
        </div>
      </section>

      <div className={styles.cols}>
        <div>
          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>{t.dashboard.section.todo}</h2>
              <Link href="/inbox" className={styles.sectionMore}>
                {t.dashboard.section.todoMore}
              </Link>
            </div>
            <TodayRows rows={todoRows} />
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>
                {t.dashboard.section.recentMerge}
                {unreadMerges > 0 && (
                  <span
                    className={styles.unreadBadge}
                    aria-label={t.dashboard.section.unreadMerges(unreadMerges)}
                  >
                    {unreadMerges}
                  </span>
                )}
              </h2>
              <MarkAllReadButton count={unreadMerges} />
            </div>
            <RecentMergesFeed items={recentMerges} displayLimit={5} />
          </section>
        </div>

        <aside>
          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>{t.dashboard.section.projects}</h2>
              <Link href="/projects" className={styles.sectionMore}>
                {t.dashboard.section.projectsMore}
              </Link>
            </div>
            <div className={styles.feedCard}>
              <DashboardProjectsWidget rows={dashboardProjects} />
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>{t.todos.widget.title}</h2>
              <Link href="/todos" className={styles.sectionMore}>
                {t.todos.widget.more}
              </Link>
            </div>
            <div className={styles.feedCard}>
              <DashboardTodosWidget todos={dashboardTodos} />
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>{t.notes.widget.title}</h2>
              <Link href="/notes" className={styles.sectionMore}>
                {t.notes.widget.more}
              </Link>
            </div>
            <div className={styles.feedCard}>
              <DashboardNotesWidget notes={dashboardPinnedNotes} />
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>{t.dashboard.section.workload}</h2>
              {/* 에이전트는 전역 드로어로 제공 — '전체 보기'가 드로어를 연다(사이드바 '에이전트'와 동일). */}
              <OpenAgentDrawerButton
                className={styles.sectionMoreButton}
                label={t.dashboard.section.workloadMore}
              />
            </div>
            <WorkloadCard rows={agentWorkloads} />
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>{t.dashboard.section.clusters}</h2>
              {/* /clusters 활성화 (PR #45). */}
              <Link href="/clusters" className={styles.sectionMore}>
                {t.dashboard.section.clustersMore}
              </Link>
            </div>
            <div className={styles.feedCard}>
              <div className={styles.feed}>
                {dashboardClusters.map((cluster) => (
                  <Link
                    key={cluster.id}
                    href={`/cluster/${cluster.id}`}
                    className={`${styles.feedItem} ${styles.clusterLink}`}
                  >
                    <span
                      className={`${styles.feedDot} ${styles.feedDotCluster}`}
                      aria-hidden="true"
                    />
                    <div className={styles.feedBody}>
                      <div className={styles.feedText}>
                        {t.dashboard.cluster.bundle(cluster.title, cluster.count)}
                      </div>
                      <span className={styles.feedTime}>{cluster.note}</span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
