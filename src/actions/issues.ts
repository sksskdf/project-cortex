'use server';

// Phase 13 — '새 이슈' 작성 Server Action. 위임 토글 ON 이면 assigneeKind='agent' 로
// 기록하고, 클라이언트가 반환된 워크스페이스에서 claude CLI 세션을 spawn 한다.

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { currentUser } from '@/lib/config';
import { buildDelegatePrompt, createIssue } from '@/lib/issues';

const schema = z.object({
  repoId: z.number().int().positive(),
  title: z.string().trim().min(1).max(200),
  spec: z.string().trim().min(1).max(4000),
  delegateToClaude: z.boolean(),
});

export type CreateIssueActionState =
  | { kind: 'idle' }
  | { kind: 'created'; id: number; delegate: { prompt: string } | null }
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

    revalidatePath('/');
    revalidatePath('/inbox');
    return {
      kind: 'created',
      id: result.id,
      delegate: delegateToClaude ? { prompt: buildDelegatePrompt(title, spec) } : null,
    };
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}
