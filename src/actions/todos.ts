'use server';

// Phase 11 — TODO CRUD Server Actions.

import { revalidatePath } from 'next/cache';
import {
  createTodo,
  deleteTodo,
  linkTodoToIssue,
  toggleTodoStatus,
  updateTodo,
  type CreateTodoInput,
  type TodoStatus,
} from '@/lib/todos';

export type TodoActionState =
  | { kind: 'idle' }
  | { kind: 'created'; id: number }
  | { kind: 'updated' }
  | { kind: 'deleted' }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string };

function revalidateAll() {
  revalidatePath('/todos');
  revalidatePath('/'); // dashboard widget
}

export async function createTodoAction(input: CreateTodoInput): Promise<TodoActionState> {
  try {
    const r = createTodo(input);
    if (r.kind === 'created') revalidateAll();
    return r;
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

export async function toggleTodoStatusAction(
  todoId: number,
  status: TodoStatus,
): Promise<TodoActionState> {
  try {
    const r = toggleTodoStatus(todoId, status);
    if (r.kind === 'updated') revalidateAll();
    return r;
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

export async function updateTodoAction(
  todoId: number,
  patch: Parameters<typeof updateTodo>[1],
): Promise<TodoActionState> {
  try {
    const r = updateTodo(todoId, patch);
    if (r.kind === 'updated') revalidateAll();
    return r;
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

export async function deleteTodoAction(todoId: number): Promise<TodoActionState> {
  try {
    const r = deleteTodo(todoId);
    if (r.kind === 'deleted') revalidateAll();
    return r;
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

// Phase 18 — TODO 를 이슈에 연결/해제. issueId=null 이면 연결 해제.
export async function linkTodoToIssueAction(
  todoId: number,
  issueId: number | null,
): Promise<TodoActionState> {
  try {
    const r = linkTodoToIssue(todoId, issueId);
    if (r.kind === 'updated') revalidateAll();
    return r;
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}
