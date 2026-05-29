'use client';

// Phase 11 — /todos 페이지의 메인 UI. 빠른 추가 + 토글 + 삭제.

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { ko as t } from '@/copy/ko';
import {
  createTodoAction,
  deleteTodoAction,
  linkTodoToIssueAction,
  toggleTodoStatusAction,
} from '@/actions/todos';
import { StatusChip } from '@/components/StatusChip';
import type { IssueOption } from '@/lib/issues';
import type { TodoPriority, TodoView } from '@/lib/todos';
import styles from './TodoList.module.css';

const priorityClass: Record<TodoPriority, string> = {
  low: styles.priorityLow,
  normal: styles.priorityNormal,
  high: styles.priorityHigh,
};

export type ProjectOption = { id: number; slug: string };

// 'all' = 전체, 'personal' = 프로젝트 미연결(개인), number = 해당 프로젝트.
type ProjectFilter = number | 'all' | 'personal';

export function TodoList({
  todos,
  projects,
  issues,
}: {
  todos: ReadonlyArray<TodoView>;
  projects: ReadonlyArray<ProjectOption>;
  issues: ReadonlyArray<IssueOption>;
}) {
  const [projectFilter, setProjectFilter] = useState<ProjectFilter>('all');
  const issueById = new Map(issues.map((i) => [i.id, i]));

  const visible = todos.filter((todo) => {
    if (projectFilter === 'personal') return todo.projectId === null;
    if (typeof projectFilter === 'number') return todo.projectId === projectFilter;
    return true;
  });
  const open = visible.filter((t) => t.status !== 'done');
  const done = visible.filter((t) => t.status === 'done');

  return (
    <div className={styles.wrap}>
      <AddTodoForm projects={projects} />

      <div className={styles.filterRow}>
        <select
          className={styles.addSelect}
          value={String(projectFilter)}
          onChange={(e) => {
            const v = e.target.value;
            setProjectFilter(v === 'all' || v === 'personal' ? v : Number(v));
          }}
          aria-label={t.todos.projectLabel}
        >
          <option value="all">{t.todos.projectFilterAll}</option>
          <option value="personal">{t.todos.projectPersonal}</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.slug}
            </option>
          ))}
        </select>
      </div>

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
              <TodoRow key={todo.id} todo={todo} issues={issues} issueById={issueById} />
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
              <TodoRow key={todo.id} todo={todo} issues={issues} issueById={issueById} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function AddTodoForm({ projects }: { projects: ReadonlyArray<ProjectOption> }) {
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<TodoPriority>('normal');
  // '' = 개인(프로젝트 미연결), 숫자 문자열 = 프로젝트 id.
  const [projectId, setProjectId] = useState('');

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (title.trim().length === 0) return;
    startTransition(async () => {
      const r = await createTodoAction({
        title: title.trim(),
        priority,
        projectId: projectId === '' ? null : Number(projectId),
      });
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
      <select
        className={styles.addSelect}
        value={projectId}
        onChange={(e) => setProjectId(e.target.value)}
        disabled={pending}
        aria-label={t.todos.projectLabel}
      >
        <option value="">{t.todos.projectPersonal}</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.slug}
          </option>
        ))}
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

function TodoRow({
  todo,
  issues,
  issueById,
}: {
  todo: TodoView;
  issues: ReadonlyArray<IssueOption>;
  issueById: Map<number, IssueOption>;
}) {
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

  function onLinkIssue(issueId: number | null) {
    startTransition(async () => {
      await linkTodoToIssueAction(todo.id, issueId);
    });
  }

  const linkedIssue = todo.issueId !== null ? (issueById.get(todo.issueId) ?? null) : null;

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
        {/* 완료는 done 섹션 + 취소선으로 이미 드러나므로 생략 — open/in-progress 만 칩 표기. */}
        {todo.status !== 'done' && <StatusChip kind="todo" status={todo.status} />}
        {todo.projectSlug && (
          <span className={styles.metaItem}>{t.todos.meta.project(todo.projectSlug)}</span>
        )}
        {todo.prId !== null && todo.prNumber !== null && (
          <Link href={`/pr/${todo.prId}`} className={styles.prLink}>
            {t.todos.meta.pr(todo.prNumber)}
          </Link>
        )}
        {linkedIssue !== null ? (
          <span className={styles.issueChip}>
            <Link href={`/issues/${linkedIssue.id}`} className={styles.prLink}>
              {t.todos.issueLink.linked(linkedIssue.title)}
            </Link>
            <button
              type="button"
              className={styles.issueClear}
              onClick={() => onLinkIssue(null)}
              disabled={pending}
              aria-label={t.todos.issueLink.clear}
              title={t.todos.issueLink.clear}
            >
              ×
            </button>
          </span>
        ) : (
          issues.length > 0 && (
            <select
              className={styles.issueSelect}
              value=""
              onChange={(e) => onLinkIssue(e.target.value === '' ? null : Number(e.target.value))}
              disabled={pending}
              aria-label={t.todos.issueLink.label}
            >
              <option value="">{t.todos.issueLink.none}</option>
              {issues.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.title}
                </option>
              ))}
            </select>
          )
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
