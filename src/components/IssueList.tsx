// 이슈 목록 UI (읽기 전용 v1). 이슈 제목 + 상태 배지 + 최신 Claude 세션 상태 +
// 결과 PR 링크를 렌더. 편집/삭제는 후속 — 인터랙션이 없어 서버 컴포넌트로 둠.

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
      <div className={styles.main}>
        <span className={styles.title}>{issue.title}</span>
        {issue.projectSlug && (
          <span className={styles.project}>{t.issues.project(issue.projectSlug)}</span>
        )}
      </div>
      <div className={styles.meta}>
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
        {issue.resultPrId !== null && issue.resultPrNumber !== null && (
          <Link href={`/pr/${issue.resultPrId}`} className={styles.prLink}>
            {t.issues.pr(issue.resultPrNumber)}
          </Link>
        )}
      </div>
    </li>
  );
}
