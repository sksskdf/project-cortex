// Phase 11 — 대시보드 사이드에 노출되는 TODO 위젯.
// 가장 우선순위 높은 open todo 최대 5개. 클릭 시 /todos.

import Link from 'next/link';
import { ko as t } from '@/copy/ko';
import type { TodoView } from '@/lib/todos';
import styles from './DashboardTodosWidget.module.css';

const priorityClass: Record<TodoView['priority'], string> = {
  low: styles.priorityLow,
  normal: styles.priorityNormal,
  high: styles.priorityHigh,
};

export function DashboardTodosWidget({ todos }: { todos: ReadonlyArray<TodoView> }) {
  if (todos.length === 0) {
    return <div className={styles.empty}>{t.todos.widget.empty}</div>;
  }
  return (
    <ul className={styles.list}>
      {todos.slice(0, 5).map((todo) => (
        <li key={todo.id} className={styles.item}>
          <span className={`${styles.dot} ${priorityClass[todo.priority]}`} aria-hidden />
          <Link href="/todos" className={styles.itemLink}>
            <span className={styles.title}>{todo.title}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
