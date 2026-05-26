// Phase 13 — Cortex 내부 이슈 작성 + Claude Code 위임.
// '새 이슈' 토글 ON 이면 assigneeKind='agent' 로 기록하고, 호출측이 등록된
// 워크스페이스에서 claude CLI 세션을 spawn 한다 (PTY 서버). 위임 prompt 는
// buildDelegatePrompt 로 이슈 spec 에서 구성.

import { asc } from 'drizzle-orm';
import { db } from '@/db/client';
import { issues, projects } from '@/db/schema';

export const CLAUDE_ASSIGNEE_ID = 'claude-code';

export type IssueRepo = { id: number; slug: string; name: string };

// '새 이슈' 폼의 레포 선택지 — 통계 없이 id·slug·name 만 가볍게.
export function listIssueRepos(): IssueRepo[] {
  return db
    .select({ id: projects.id, slug: projects.slug, name: projects.name })
    .from(projects)
    .orderBy(asc(projects.slug))
    .all();
}

export type CreateIssueInput = {
  repoId: number;
  title: string;
  spec: string;
  delegateToClaude: boolean;
  humanAssigneeId: string;
};

export function createIssue(
  input: CreateIssueInput,
): { kind: 'created'; id: number } | { kind: 'error'; message: string } {
  const title = input.title.trim();
  const spec = input.spec.trim();
  if (title.length === 0) return { kind: 'error', message: '제목은 필수' };
  if (spec.length === 0) return { kind: 'error', message: '스펙은 필수' };

  const row = db
    .insert(issues)
    .values({
      repoId: input.repoId,
      title,
      spec,
      assigneeKind: input.delegateToClaude ? 'agent' : 'human',
      assigneeId: input.delegateToClaude ? CLAUDE_ASSIGNEE_ID : input.humanAssigneeId,
      status: input.delegateToClaude ? 'in-progress' : 'open',
    })
    .returning({ id: issues.id })
    .get();
  return { kind: 'created', id: row.id };
}

// claude CLI 세션에 처음 보낼 prompt. 이슈 제목 + 수용 기준(spec)을 자연어로 전달.
export function buildDelegatePrompt(title: string, spec: string): string {
  return `이슈: ${title.trim()}\n\n${spec.trim()}`;
}
