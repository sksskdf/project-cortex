// 이슈 상세 뷰 (읽기 전용). 제목·상태·메타 + 스펙(마크다운) + Claude 세션 이력.

import Link from 'next/link';
import { ko as t } from '@/copy/ko';
import { Markdown } from '@/components/Markdown';
import { IssueRoadmapLink } from '@/components/IssueRoadmapLink';
import { formatRelativeAge } from '@/lib/format';
import type {
  AgentRunView,
  IssueDetail as IssueDetailData,
  IssueStatus,
  SessionStatus,
} from '@/lib/issues';
import type { RoadmapItemOption } from '@/lib/roadmap';
import styles from './IssueDetail.module.css';

const statusClass: Record<IssueStatus, string> = {
  open: styles.statusOpen,
  'in-progress': styles.statusInProgress,
  done: styles.statusDone,
  closed: styles.statusClosed,
};

const sessionClass: Record<SessionStatus, string> = {
  queued: styles.sessionQueued,
  running: styles.sessionRunning,
  completed: styles.sessionCompleted,
  failed: styles.sessionFailed,
};

const d = t.issues.detail;

export function IssueDetail({
  detail,
  roadmapItemOptions,
}: {
  detail: IssueDetailData;
  roadmapItemOptions: ReadonlyArray<RoadmapItemOption>;
}) {
  return (
    <div className={styles.page}>
      <Link href="/issues" className={styles.back}>
        ← {d.back}
      </Link>

      <header className={styles.header}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>{detail.title}</h1>
          <span className={`${styles.badge} ${statusClass[detail.status]}`}>
            {t.issues.status[detail.status]}
          </span>
        </div>
        <dl className={styles.meta}>
          {detail.projectSlug && (
            <div className={styles.metaItem}>
              <dt className={styles.metaKey}>{t.nav.projects}</dt>
              <dd className={styles.metaVal}>{detail.projectSlug}</dd>
            </div>
          )}
          <div className={styles.metaItem}>
            <dt className={styles.metaKey}>{d.assignee}</dt>
            <dd className={styles.metaVal}>
              {detail.assigneeKind === 'agent' ? d.assigneeAgent : detail.assigneeId}
            </dd>
          </div>
          <div className={styles.metaItem}>
            <dt className={styles.metaKey}>{d.created}</dt>
            <dd className={styles.metaVal}>{formatRelativeAge(detail.createdAt.getTime())}</dd>
          </div>
        </dl>
        {detail.projectSlug && (
          <IssueRoadmapLink
            issueId={detail.id}
            currentItemId={detail.roadmapItemId}
            options={roadmapItemOptions}
          />
        )}
      </header>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{d.spec}</h2>
        <div className={styles.spec}>
          <Markdown>{detail.spec}</Markdown>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{d.runsTitle}</h2>
        {detail.runs.length === 0 ? (
          <div className={styles.runsEmpty}>{d.runsEmpty}</div>
        ) : (
          <ul className={styles.runs}>
            {detail.runs.map((run) => (
              <RunRow key={run.id} run={run} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function RunRow({ run }: { run: AgentRunView }) {
  return (
    <li className={styles.run}>
      <span className={`${styles.session} ${sessionClass[run.status]}`}>
        {t.issues.session[run.status]}
      </span>
      <span className={styles.runTimes}>
        {run.startedAt && `${d.runStarted} ${formatRelativeAge(run.startedAt.getTime())}`}
        {run.completedAt && ` · ${d.runCompleted} ${formatRelativeAge(run.completedAt.getTime())}`}
      </span>
      {run.resultPrId !== null && run.resultPrNumber !== null && (
        <Link href={`/pr/${run.resultPrId}`} className={styles.prLink}>
          {d.runResult} {t.issues.pr(run.resultPrNumber)}
        </Link>
      )}
    </li>
  );
}
