// Phase 11 — /todos 페이지. 개인 작업 목록.

import { ko as t } from '@/copy/ko';
import { TodoList } from '@/components/TodoList';
import { listTodos } from '@/lib/todos';
import styles from './page.module.css';

export default function TodosPage() {
  const todos = listTodos('all');
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t.todos.title}</h1>
        <p className={styles.subtitle}>{t.todos.subtitle}</p>
      </header>
      <TodoList todos={todos} />
    </div>
  );
}
