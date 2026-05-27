// 이슈 목록 UI (읽기 전용). 행 클릭 시 상세(/issues/[id]) 이동, 제목 + 상태 배지 +
// 최신 Claude 세션 상태 + 결과 PR 링크. 편집/삭제 없음 (위임 시점에 에이전트 실행).

import Link from 'next/link';
import { ko as t } from '@/copy/ko';
import type { IssueStatus, IssueView, SessionStatus } from '@/lib/issues';
import styles from './IssueList.module.css';

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

export function IssueList({ issues }: { issues: ReadonlyArray<IssueView> }) {
  if (issues.length === 0) {
    return <div className={styles.empty}>{t.issues.empty}</div>;
  }

  return (
    <ul className={styles.list}>
      {issues.map((issue) => (
        <IssueRow key={issue.id} issue={issue} />
      ))}
    </ul>
  );
}

function IssueRow({ issue }: { issue: IssueView }) {
  return (
    <li className={styles.row}>
      <Link href={`/issues/${issue.id}`} className={styles.rowLink}>
        <span className={styles.main}>
          <span className={styles.title}>{issue.title}</span>
          {issue.projectSlug && (
            <span className={styles.project}>{t.issues.project(issue.projectSlug)}</span>
          )}
        </span>
        <span className={styles.meta}>
          <span className={`${styles.badge} ${statusClass[issue.status]}`}>
            {t.issues.status[issue.status]}
          </span>
          <span
            className={`${styles.session} ${
              issue.sessionStatus ? sessionClass[issue.sessionStatus] : ''
            }`}
          >
            {issue.sessionStatus ? t.issues.session[issue.sessionStatus] : t.issues.session.none}
          </span>
        </span>
      </Link>
      {issue.resultPrId !== null && issue.resultPrNumber !== null && (
        <Link href={`/pr/${issue.resultPrId}`} className={styles.prLink}>
          {t.issues.pr(issue.resultPrNumber)}
        </Link>
      )}
    </li>
  );
}
