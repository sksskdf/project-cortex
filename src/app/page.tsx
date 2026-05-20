import Link from 'next/link';
import { ko as t } from '@/copy/ko';
import { AgentFaceIcon, AlertIcon, BellIcon, CheckIcon, InfoIcon } from '@/components/icons';
import { agentWorkloads, type AgentWorkload } from '@/fixtures/dashboard';
import { currentUser } from '@/lib/config';
import {
  getDashboardClusters,
  getDashboardStats,
  getRecentAutoMerges,
  getTodayRows,
} from '@/lib/dashboard';
import type { GaugeTier, PR, StatDelta, TagTone } from '@/lib/types';
import styles from './page.module.css';

type WorkloadBarTone = AgentWorkload['bar'];

const tagToneClass: Record<TagTone, string> = {
  red: 'ds-tag--red',
  yellow: 'ds-tag--yellow',
  purple: 'ds-tag--purple',
  green: 'ds-tag--green',
  gray: 'ds-tag--gray',
  'sky-blue': 'ds-tag--sky-blue',
  cyan: 'ds-tag--cyan',
};

const gaugeBarClass: Record<GaugeTier, string> = {
  success: styles.gaugeBarSuccess,
  blue: styles.gaugeBarBlue,
  warning: styles.gaugeBarWarning,
  error: styles.gaugeBarError,
};

const workloadBarClass: Record<WorkloadBarTone, string> = {
  blue: styles.workloadBar,
  green: `${styles.workloadBar} ${styles.workloadBarGreen}`,
  yellow: `${styles.workloadBar} ${styles.workloadBarYellow}`,
};

const GAUGE_CIRCUMFERENCE = 2 * Math.PI * 15;

function plusIcon(width = 16, height = 16, strokeWidth = 2.5) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1={12} y1={5} x2={12} y2={19} />
      <line x1={5} y1={12} x2={19} y2={12} />
    </svg>
  );
}

function startIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx={12} cy={12} r={3} />
      <path d="M12 2v4m0 12v4M2 12h4m12 0h4" />
    </svg>
  );
}

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

function Gauge({ value, tier }: { value: number; tier: GaugeTier }) {
  const offset = GAUGE_CIRCUMFERENCE - (value / 100) * GAUGE_CIRCUMFERENCE;
  return (
    <div className={styles.gauge}>
      <svg className={styles.gaugeSvg} width={36} height={36} viewBox="0 0 36 36">
        <circle className={styles.gaugeTrack} cx={18} cy={18} r={15} strokeWidth={3} />
        <circle
          className={`${styles.gaugeBar} ${gaugeBarClass[tier]}`}
          cx={18}
          cy={18}
          r={15}
          strokeWidth={3}
          strokeDasharray={GAUGE_CIRCUMFERENCE}
          strokeDashoffset={offset}
        />
      </svg>
      <span className={styles.gaugeLabel}>{value}</span>
    </div>
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

function TodoRowCard({ row }: { row: PR }) {
  const isAlert = row.reason.tone === 'alert';
  return (
    <Link href={`/pr/${row.id}`} className={styles.todoRow}>
      <Gauge value={row.gauge.value} tier={row.gauge.tier} />
      <div className={styles.todoBody}>
        <div className={styles.todoTitle}>{row.title}</div>
        <div className={styles.todoMeta}>
          <span
            className={`${styles.author} ${row.author.kind === 'agent' ? styles.authorAgent : styles.authorHuman}`}
          >
            <AgentFaceIcon />
            {row.author.name}
          </span>
          {row.tags.map((tag) => (
            <span key={tag.label} className={`ds-tag ds-tag--md ${tagToneClass[tag.tone]}`}>
              {tag.label}
            </span>
          ))}
        </div>
        <div className={`${styles.todoReason} ${isAlert ? '' : styles.todoReasonInfo}`}>
          {isAlert ? <AlertIcon size={12} /> : <InfoIcon size={12} />}
          {row.reason.text}
        </div>
      </div>
      <div className={styles.todoRight}>
        <span>{t.dashboard.todoRow.diff(row.additions, row.deletions)}</span>
        <span>{row.ageText}</span>
      </div>
    </Link>
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
  const [dashboardStats, todoRows, recentAutoMerges, dashboardClusters] = await Promise.all([
    getDashboardStats(),
    getTodayRows(3),
    getRecentAutoMerges(5),
    getDashboardClusters(),
  ]);
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
          <button type="button" className={styles.iconBtn} aria-label={t.dashboard.notifications}>
            <BellIcon />
            <span className={`ds-badge ds-badge--pill ${styles.iconBtnBadge}`}>3</span>
          </button>
          <button type="button" className="ds-btn ds-btn--md ds-btn--outlined-basic">
            <span className="ds-btn__icon" aria-hidden="true">
              {startIcon()}
            </span>
            <span className="ds-btn__label">{t.dashboard.startAgent}</span>
          </button>
          <button type="button" className="ds-btn ds-btn--md ds-btn--filled-blue">
            <span className="ds-btn__icon" aria-hidden="true">
              {plusIcon()}
            </span>
            <span className="ds-btn__label">{t.dashboard.newIssue}</span>
          </button>
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
              {boltIcon()}
            </span>
          </div>
          <div className={styles.statLabel}>{t.dashboard.stat.agentsRunning}</div>
          <div className={styles.statValue}>{dashboardStats.agentsRunning.value}</div>
          <span className={`${styles.statDelta} ${styles.statDeltaFlat}`}>
            {runningDotIcon()}
            {t.dashboard.stat.runningNow}
          </span>
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
            <div className={styles.todoList}>
              {todoRows.map((row) => (
                <TodoRowCard key={row.id} row={row} />
              ))}
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>{t.dashboard.section.recentAutoMerge}</h2>
              {/* /activity 라우트는 Phase 7 (보고서) 진입 시 활성화. */}
              <span className={styles.sectionMoreDisabled}>{t.nav.comingSoon}</span>
            </div>
            <div className={styles.feedCard}>
              <div className={styles.feed}>
                {recentAutoMerges.map((item) => (
                  <div key={item.id} className={styles.feedItem}>
                    <span className={styles.feedDot} aria-hidden="true" />
                    <div className={styles.feedBody}>
                      <div className={styles.feedText}>
                        {t.dashboard.feed.autoMerged(item.agent, item.title, item.score)}
                      </div>
                      <span className={styles.feedTime}>
                        {item.ageText} · {item.repo}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>

        <aside>
          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>{t.dashboard.section.workload}</h2>
              {/* /agents 라우트는 Phase 8 진입 시 활성화. */}
              <span className={styles.sectionMoreDisabled}>{t.nav.comingSoon}</span>
            </div>
            <WorkloadCard rows={agentWorkloads} />
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>{t.dashboard.section.clusters}</h2>
              {/* /clusters 라우트는 Phase 6 진입 시 활성화. */}
              <span className={styles.sectionMoreDisabled}>{t.nav.comingSoon}</span>
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
