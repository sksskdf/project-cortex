'use client';

// Phase 11 — /todos 페이지의 메인 UI. 빠른 추가 + 토글 + 삭제.

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { ko as t } from '@/copy/ko';
import { createTodoAction, deleteTodoAction, toggleTodoStatusAction } from '@/actions/todos';
import type { TodoPriority, TodoView } from '@/lib/todos';
import styles from './TodoList.module.css';

const priorityClass: Record<TodoPriority, string> = {
  low: styles.priorityLow,
  normal: styles.priorityNormal,
  high: styles.priorityHigh,
};

export function TodoList({ todos }: { todos: ReadonlyArray<TodoView> }) {
  const open = todos.filter((t) => t.status !== 'done');
  const done = todos.filter((t) => t.status === 'done');

  return (
    <div className={styles.wrap}>
      <AddTodoForm />

      <section className={styles.section}>
        <header className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>{t.todos.section.open}</h2>
          <span className={styles.sectionCount}>{open.length}</span>
        </header>
        {open.length === 0 ? (
          <div className={styles.empty}>{t.todos.empty}</div>
        ) : (
          <ul className={styles.list}>
            {open.map((todo) => (
              <TodoRow key={todo.id} todo={todo} />
            ))}
          </ul>
        )}
      </section>

      {done.length > 0 && (
        <section className={styles.section}>
          <header className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>{t.todos.section.done}</h2>
            <span className={styles.sectionCount}>{done.length}</span>
          </header>
          <ul className={`${styles.list} ${styles.listDone}`}>
            {done.map((todo) => (
              <TodoRow key={todo.id} todo={todo} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function AddTodoForm() {
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<TodoPriority>('normal');

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (title.trim().length === 0) return;
    startTransition(async () => {
      const r = await createTodoAction({ title: title.trim(), priority });
      if (r.kind === 'created') {
        setTitle('');
      }
    });
  }

  return (
    <form className={styles.addForm} onSubmit={onSubmit}>
      <input
        type="text"
        className={styles.addInput}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t.todos.add.placeholder}
        disabled={pending}
        aria-label={t.todos.add.placeholder}
      />
      <select
        className={styles.addSelect}
        value={priority}
        onChange={(e) => setPriority(e.target.value as TodoPriority)}
        disabled={pending}
        aria-label={t.todos.add.prioritySelect}
      >
        <option value="low">{t.todos.priority.low}</option>
        <option value="normal">{t.todos.priority.normal}</option>
        <option value="high">{t.todos.priority.high}</option>
      </select>
      <button
        type="submit"
        className="ds-btn ds-btn--md ds-btn--filled-blue"
        disabled={pending}
        aria-busy={pending}
      >
        <span className="ds-btn__label">{t.todos.add.submit}</span>
      </button>
    </form>
  );
}

function TodoRow({ todo }: { todo: TodoView }) {
  const [pending, startTransition] = useTransition();

  function onToggle() {
    const next = todo.status === 'done' ? 'open' : 'done';
    startTransition(async () => {
      await toggleTodoStatusAction(todo.id, next);
    });
  }

  function onDelete() {
    startTransition(async () => {
      await deleteTodoAction(todo.id);
    });
  }

  return (
    <li className={`${styles.row} ${todo.status === 'done' ? styles.rowDone : ''}`}>
      <label className={styles.checkLabel}>
        <input
          type="checkbox"
          checked={todo.status === 'done'}
          onChange={onToggle}
          disabled={pending}
          aria-label={t.todos.actions.toggle}
        />
        <span className={`${styles.priorityDot} ${priorityClass[todo.priority]}`} aria-hidden />
        <span className={styles.title}>{todo.title}</span>
      </label>
      <div className={styles.meta}>
        {todo.projectSlug && (
          <span className={styles.metaItem}>{t.todos.meta.project(todo.projectSlug)}</span>
        )}
        {todo.prId !== null && todo.prNumber !== null && (
          <Link href={`/pr/${todo.prId}`} className={styles.prLink}>
            {t.todos.meta.pr(todo.prNumber)}
          </Link>
        )}
      </div>
      <button
        type="button"
        className={styles.delete}
        onClick={onDelete}
        disabled={pending}
        aria-label={t.todos.actions.delete}
        title={t.todos.actions.delete}
      >
        ×
      </button>
    </li>
  );
}
