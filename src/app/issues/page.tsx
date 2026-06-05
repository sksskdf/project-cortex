// 이슈 목록 — '새 이슈' 로 작성한 이슈와 위임된 Claude 세션 상태 + 결과 PR 을 한눈에.
// 읽기 전용 v1.

import { ko as t } from '@/copy/ko';
import { IssueList } from '@/components/IssueList';
import { WorkTabs } from '@/components/WorkTabs';
import { listIssues } from '@/lib/issues';
import { getWorkTabCounts } from '@/lib/work-view';
import styles from './page.module.css';

export default function IssuesPage() {
  const issues = listIssues();
  const counts = getWorkTabCounts();
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t.issues.title}</h1>
        <p className={styles.subtitle}>{t.issues.subtitle}</p>
      </header>
      <WorkTabs issues={counts.issues} todos={counts.todos} />
      <IssueList issues={issues} />
    </div>
  );
}
