'use server';

// Phase 11 — TODO CRUD Server Actions.

import { revalidatePath } from 'next/cache';
import {
  createTodo,
  deleteTodo,
  linkTodoToIssue,
  promoteTodoToIssue,
  toggleTodoStatus,
  updateTodo,
  type CreateTodoInput,
  type TodoStatus,
} from '@/lib/todos';
import { buildCortexContextPreamble } from '@/lib/cortex-context';
import { buildDelegatePrompt, startAgentRun } from '@/lib/issues';
import { getWorkspace } from '@/lib/workspace';
import { currentUser } from '@/lib/config';
import type { DelegateInfo } from '@/actions/issues';

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

// Phase 18 — TODO 를 이슈로 승격(= Claude 위임). createIssueAction 과 동일하게, 위임 시
// 워크스페이스가 있으면 autoStart(클라이언트가 claude 세션 spawn) 정보를 반환한다.
export type PromoteTodoActionState =
  | { kind: 'promoted'; issueId: number; delegate: DelegateInfo | null }
  | { kind: 'no-project' }
  | { kind: 'already-linked'; issueId: number }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string };

export async function promoteTodoToIssueAction(todoId: number): Promise<PromoteTodoActionState> {
  try {
    const r = promoteTodoToIssue(todoId, {
      delegateToClaude: true,
      humanAssigneeId: currentUser.githubLogin,
    });
    if (r.kind !== 'promoted') return r;

    // 위임 prompt + (워크스페이스 있으면) 자동 spawn 정보 — createIssueAction 과 동일 패턴.
    const prompt =
      buildCortexContextPreamble(r.repoId, r.issueId) + buildDelegatePrompt(r.title, r.spec);
    const workspace = getWorkspace(r.repoId);
    const autoStart = workspace
      ? {
          workspaceId: workspace.id,
          sessionName: r.title,
          agentRunId: startAgentRun(r.issueId),
          prompt,
        }
      : null;

    revalidateAll();
    revalidatePath('/issues');
    return { kind: 'promoted', issueId: r.issueId, delegate: { prompt, autoStart } };
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}
