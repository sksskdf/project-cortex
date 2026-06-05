// Phase 18 — 통합 "작업" 뷰. 로드맵 산출물 ▸ 연결된 이슈 ▸ 그 이슈의 TODO/결과 PR 을 한 화면에.
// 활성 이슈(open/in-progress)만. 읽기 전용 v1.

import Link from 'next/link';
import { ko as t } from '@/copy/ko';
import { StatusChip } from '@/components/StatusChip';
import { WorkTabs } from '@/components/WorkTabs';
import { getWorkView, getWorkTabCounts } from '@/lib/work-view';
import styles from './page.module.css';

export default function WorkPage() {
  const projects = getWorkView();
  const counts = getWorkTabCounts();
  const w = t.work;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{w.title}</h1>
        <p className={styles.subtitle}>{w.subtitle}</p>
      </header>

      <WorkTabs issues={counts.issues} todos={counts.todos} />

      {projects.length === 0 ? (
        <div className={styles.empty}>{w.empty}</div>
      ) : (
        projects.map((proj) => (
          <section key={proj.projectId} className={styles.project}>
            <h2 className={styles.projectTitle}>{proj.projectSlug}</h2>
            {proj.groups.map((group) => (
              <div key={group.roadmapItemId ?? 'unlinked'} className={styles.group}>
                <div className={styles.groupTitle}>{group.roadmapItemTitle ?? w.unlinked}</div>
                <ul className={styles.issues}>
                  {group.issues.map((issue) => (
                    <li key={issue.id} className={styles.issue}>
                      <div className={styles.issueHead}>
                        <StatusChip kind="issue" status={issue.status} />
                        <span className={styles.issueTitle}>{issue.title}</span>
                        {issue.sessionStatus && (
                          <span className={styles.session}>{w.session(issue.sessionStatus)}</span>
                        )}
                        {issue.resultPrId !== null && (
                          <Link href={`/pr/${issue.resultPrId}`} className={styles.prLink}>
                            #{issue.resultPrNumber ?? '?'}
                          </Link>
                        )}
                      </div>
                      {issue.todos.length > 0 && (
                        <ul className={styles.todos}>
                          {issue.todos.map((todo) => (
                            <li key={todo.id} className={styles.todo}>
                              <StatusChip kind="todo" status={todo.status} />
                              <span>{todo.title}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        ))
      )}
    </div>
  );
}
