'use server';

// Phase 13 — '새 이슈' 작성 Server Action. 위임 토글 ON 이면 assigneeKind='agent' 로
// 기록하고, 클라이언트가 반환된 워크스페이스에서 claude CLI 세션을 spawn 한다.

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { currentUser } from '@/lib/config';
import {
  buildDelegatePrompt,
  completeIssueDelegation,
  createIssue,
  startAgentRun,
  type CompleteDelegationResult,
} from '@/lib/issues';
import { getWorkspace } from '@/lib/workspace';

const schema = z.object({
  repoId: z.number().int().positive(),
  title: z.string().trim().min(1).max(200),
  spec: z.string().trim().min(1).max(4000),
  delegateToClaude: z.boolean(),
});

// 위임 시 반환. autoStart 가 있으면 클라이언트가 그 워크스페이스에서 이슈명 세션을 자동
// spawn 하고 agentRunId 를 세션에 묶는다. 등록된 워크스페이스가 없으면 autoStart=null —
// 자동 실행 불가하므로 prompt 만 띄워 수동 복사로 폴백.
export type DelegateInfo = {
  prompt: string;
  // autoStart.prompt = claude 세션의 초기 prompt — 세션 spawn 시 작업 지시로 바로 전달된다.
  autoStart: {
    workspaceId: number;
    sessionName: string;
    agentRunId: number;
    prompt: string;
  } | null;
};

export type CreateIssueActionState =
  | { kind: 'idle' }
  | { kind: 'created'; id: number; delegate: DelegateInfo | null }
  | { kind: 'invalid'; message: string }
  | { kind: 'error'; message: string };

export async function createIssueAction(input: {
  repoId: number;
  title: string;
  spec: string;
  delegateToClaude: boolean;
}): Promise<CreateIssueActionState> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return {
      kind: 'invalid',
      message: parsed.error.issues[0]?.message ?? '입력이 올바르지 않습니다.',
    };
  }
  const { repoId, title, spec, delegateToClaude } = parsed.data;

  try {
    const result = createIssue({
      repoId,
      title,
      spec,
      delegateToClaude,
      humanAssigneeId: currentUser.githubLogin,
    });
    if (result.kind === 'error') return { kind: 'invalid', message: result.message };

    let delegate: DelegateInfo | null = null;
    if (delegateToClaude) {
      const prompt = buildDelegatePrompt(title, spec);
      // 레포에 등록된 로컬 워크스페이스가 있으면 세션을 자동 spawn 할 수 있다 — agent_run 을
      // running 으로 만들고 autoStart 정보를 반환. 없으면 자동 실행 불가 → prompt 만(수동 폴백).
      const workspace = getWorkspace(repoId);
      const autoStart = workspace
        ? {
            workspaceId: workspace.id,
            sessionName: title,
            agentRunId: startAgentRun(result.id),
            prompt,
          }
        : null;
      delegate = { prompt, autoStart };
    }

    revalidatePath('/');
    revalidatePath('/inbox');
    return { kind: 'created', id: result.id, delegate };
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

// Phase 13.4 — 위임 완료 처리(수동). 멈춰있는 agent_run 들을 마감하고 이슈를 done 으로.
export type CompleteDelegationActionState =
  | CompleteDelegationResult
  | { kind: 'error'; message: string };

export async function completeIssueDelegationAction(
  issueId: number,
): Promise<CompleteDelegationActionState> {
  try {
    const r = completeIssueDelegation(issueId);
    if (r.kind === 'completed') {
      revalidatePath(`/issues/${issueId}`);
      revalidatePath('/issues');
      revalidatePath('/'); // 대시보드 '진행 중' 카운트.
    }
    return r;
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}
