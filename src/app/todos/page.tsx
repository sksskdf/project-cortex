// Phase 11 — /todos 페이지. 개인 작업 목록.

import { ko as t } from '@/copy/ko';
import { TodoList } from '@/components/TodoList';
import { listTodos } from '@/lib/todos';
import { listProjectsWithStats } from '@/lib/projects';
import styles from './page.module.css';

export default function TodosPage() {
  const todos = listTodos('all');
  const projects = listProjectsWithStats().map((p) => ({ id: p.id, slug: p.slug }));
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t.todos.title}</h1>
        <p className={styles.subtitle}>{t.todos.subtitle}</p>
      </header>
      <TodoList todos={todos} projects={projects} />
    </div>
  );
}
