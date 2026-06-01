// Phase 11 — TODO CRUD. 단순 개인 작업 목록.
// 로드맵 item 과 별개 — 로드맵은 "산출물 (배포 단위)", todo 는 데일리 자유 작업.
// 연결 PR/프로젝트는 옵션 — 단순 메모도 가능.

import { asc, desc, eq, or } from 'drizzle-orm';
import { db } from '@/db/client';
import { projects, prs, todos, type TodoRow } from '@/db/schema';
import { createIssue } from './issues';

export type TodoStatus = 'open' | 'in-progress' | 'done';
export type TodoPriority = 'low' | 'normal' | 'high';

export type TodoView = {
  id: number;
  title: string;
  note: string | null;
  status: TodoStatus;
  priority: TodoPriority;
  dueAt: Date | null;
  projectId: number | null;
  projectSlug: string | null;
  prId: number | null;
  prNumber: number | null;
  // 이슈/TODO/로드맵 통합 1단계 — 이 TODO 가 속한 이슈 (옵션).
  issueId: number | null;
  completedAt: Date | null;
  createdAt: Date;
};

function rowToView(
  row: TodoRow,
  projectById: Map<number, string>,
  prNumberById: Map<number, number>,
): TodoView {
  return {
    id: row.id,
    title: row.title,
    note: row.note,
    status: row.status as TodoStatus,
    priority: row.priority as TodoPriority,
    dueAt: row.dueAt,
    projectId: row.projectId,
    projectSlug: row.projectId !== null ? (projectById.get(row.projectId) ?? null) : null,
    prId: row.prId,
    prNumber: row.prId !== null ? (prNumberById.get(row.prId) ?? null) : null,
    issueId: row.issueId,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
  };
}

// open + in-progress 우선 (priority 높은 순 + due 임박 순) → done 끝.
// 단일 사용자라 정교한 정렬 X.
export function listTodos(filter: 'all' | 'open' | 'done' = 'all'): TodoView[] {
  const whereClause =
    filter === 'open'
      ? or(eq(todos.status, 'open'), eq(todos.status, 'in-progress'))
      : filter === 'done'
        ? eq(todos.status, 'done')
        : undefined;

  const rows = (whereClause ? db.select().from(todos).where(whereClause) : db.select().from(todos))
    .orderBy(
      // done 은 뒤로.
      asc(todos.completedAt),
      // priority high → normal → low.
      desc(todos.priority),
      // due 임박 순 (null 은 뒤).
      asc(todos.dueAt),
      desc(todos.createdAt),
    )
    .all();

  // project + pr 메타 한 번에.
  const projectIds = Array.from(
    new Set(rows.map((r) => r.projectId).filter((id): id is number => id !== null)),
  );
  const prIds = Array.from(
    new Set(rows.map((r) => r.prId).filter((id): id is number => id !== null)),
  );
  const projectById = new Map<number, string>();
  const prNumberById = new Map<number, number>();
  if (projectIds.length > 0) {
    const pRows = db.select({ id: projects.id, slug: projects.slug }).from(projects).all();
    for (const r of pRows) projectById.set(r.id, r.slug);
  }
  if (prIds.length > 0) {
    const pRows = db.select({ id: prs.id, number: prs.number }).from(prs).all();
    for (const r of pRows) prNumberById.set(r.id, r.number);
  }

  return rows.map((r) => rowToView(r, projectById, prNumberById));
}

export type CreateTodoInput = {
  title: string;
  note?: string | null;
  priority?: TodoPriority;
  dueAt?: Date | null;
  projectId?: number | null;
  prId?: number | null;
};

export function createTodo(
  input: CreateTodoInput,
): { kind: 'created'; id: number } | { kind: 'error'; message: string } {
  const title = input.title.trim();
  if (title.length === 0) return { kind: 'error', message: '제목은 필수' };
  const row = db
    .insert(todos)
    .values({
      title,
      note: input.note ?? null,
      priority: input.priority ?? 'normal',
      dueAt: input.dueAt ?? null,
      projectId: input.projectId ?? null,
      prId: input.prId ?? null,
    })
    .returning({ id: todos.id })
    .get();
  return { kind: 'created', id: row.id };
}

export function toggleTodoStatus(
  todoId: number,
  status: TodoStatus,
): { kind: 'updated' } | { kind: 'not-found' } {
  const existing = db.select({ id: todos.id }).from(todos).where(eq(todos.id, todoId)).get();
  if (!existing) return { kind: 'not-found' };
  db.update(todos)
    .set({
      status,
      completedAt: status === 'done' ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(todos.id, todoId))
    .run();
  return { kind: 'updated' };
}

export function updateTodo(
  todoId: number,
  patch: Partial<{
    title: string;
    note: string | null;
    priority: TodoPriority;
    dueAt: Date | null;
  }>,
): { kind: 'updated' } | { kind: 'not-found' } {
  const existing = db.select({ id: todos.id }).from(todos).where(eq(todos.id, todoId)).get();
  if (!existing) return { kind: 'not-found' };
  db.update(todos)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(todos.id, todoId))
    .run();
  return { kind: 'updated' };
}

// 이슈/TODO/로드맵 통합 1단계 — TODO 를 이슈에 연결 (null 이면 연결 해제).
// 읽기는 TodoView.issueId 로.
export function linkTodoToIssue(
  todoId: number,
  issueId: number | null,
): { kind: 'updated' } | { kind: 'not-found' } {
  const existing = db.select({ id: todos.id }).from(todos).where(eq(todos.id, todoId)).get();
  if (!existing) return { kind: 'not-found' };
  db.update(todos).set({ issueId, updatedAt: new Date() }).where(eq(todos.id, todoId)).run();
  return { kind: 'updated' };
}

export function deleteTodo(todoId: number): { kind: 'deleted' } | { kind: 'not-found' } {
  const existing = db.select({ id: todos.id }).from(todos).where(eq(todos.id, todoId)).get();
  if (!existing) return { kind: 'not-found' };
  db.delete(todos).where(eq(todos.id, todoId)).run();
  return { kind: 'deleted' };
}

// Phase 18 — 승격 플로우. TODO 를 이슈로 승격(= Claude 위임 후보)한다. 고도(altitude) 계층상
// TODO → 이슈 → 로드맵 산출물. 이슈는 repo 에 묶이므로 projectId 가 있는 TODO 만 승격 가능
// (어느 레포의 작업인지 명확해야 위임이 가능). 이미 이슈에 연결된 TODO 는 재승격 불가.
// 승격 = 이슈 생성(delegate 옵션) + TODO↔이슈 연결 + TODO 를 in-progress 로. 위임 spawn(claude
// 세션)은 action 레이어가 createIssueAction 과 동일하게 처리.
export type PromoteTodoResult =
  | { kind: 'promoted'; issueId: number; repoId: number; title: string; spec: string }
  | { kind: 'not-found' }
  | { kind: 'no-project' }
  | { kind: 'already-linked'; issueId: number }
  | { kind: 'error'; message: string };

export function promoteTodoToIssue(
  todoId: number,
  opts: { delegateToClaude: boolean; humanAssigneeId: string },
): PromoteTodoResult {
  const todo = db.select().from(todos).where(eq(todos.id, todoId)).get();
  if (!todo) return { kind: 'not-found' };
  if (todo.projectId === null) return { kind: 'no-project' };
  if (todo.issueId !== null) return { kind: 'already-linked', issueId: todo.issueId };

  // spec — TODO note 가 있으면 그걸, 없으면 제목을 spec 으로(이슈 spec 은 필수).
  const spec = todo.note?.trim() || todo.title.trim();
  const created = createIssue({
    repoId: todo.projectId,
    title: todo.title,
    spec,
    delegateToClaude: opts.delegateToClaude,
    humanAssigneeId: opts.humanAssigneeId,
  });
  if (created.kind === 'error') return { kind: 'error', message: created.message };

  // TODO ↔ 이슈 연결 + TODO 를 in-progress 로(이슈가 작업을 이어받음).
  db.update(todos)
    .set({ issueId: created.id, status: 'in-progress', updatedAt: new Date() })
    .where(eq(todos.id, todoId))
    .run();

  return { kind: 'promoted', issueId: created.id, repoId: todo.projectId, title: todo.title, spec };
}

// 사이드바 widget 용 — open todo 카운트.
export function countOpenTodos(): number {
  const result = db
    .select({ n: todos.id })
    .from(todos)
    .where(or(eq(todos.status, 'open'), eq(todos.status, 'in-progress')))
    .all();
  return result.length;
}
