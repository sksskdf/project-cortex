// 이슈 목록 — '새 이슈' 로 작성한 이슈와 위임된 Claude 세션 상태 + 결과 PR 을 한눈에.
// 읽기 전용 v1.

import { ko as t } from '@/copy/ko';
import { IssueList } from '@/components/IssueList';
import { listIssues } from '@/lib/issues';
import styles from './page.module.css';

export default function IssuesPage() {
  const issues = listIssues();
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t.issues.title}</h1>
        <p className={styles.subtitle}>{t.issues.subtitle}</p>
      </header>
      <IssueList issues={issues} />
    </div>
  );
}
