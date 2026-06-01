// Phase 16 — 에이전트 세션 worktree 격리. 위임 claude 세션이 워크스페이스(=dev 서버가 보는
// 체크아웃)의 브랜치를 바꿔 dev 서버가 오락가락하고 로컬 잔존 브랜치가 쌓이는 문제를, 세션마다
// 별도 git worktree(전용 디렉토리 + 브랜치)에서 spawn 해 해소한다. 메인 작업트리는 그대로.
//
// 설정 토글(agentWorktreeEnabled, 기본 OFF)로 opt-in. OFF 면 이 모듈은 전혀 관여하지 않고
// 세션은 기존처럼 워크스페이스 cwd 에서 돈다(무회귀).
//
// pty 세션 lifecycle 이 동기(createSession/resumeDormant 가 sync)라 git 도 동기(execFileSync)로
// 호출 — 단일 사용자 localhost 기준 세션 생성/종료 시의 짧은 블록은 허용. 실패는 null/no-op 로
// 흘려 워크스페이스 cwd 폴백.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

// 세션 worktree 경로 — 워크스페이스의 형제 디렉토리(.cortex-worktrees) 아래. repo 내부에 중첩하면
// 그 자체가 변경/추적 대상이 되므로 형제로 둔다. sessionId 로 결정적이라 resume·정리 시 재계산 가능.
export function worktreePathFor(workspaceLocalPath: string, sessionId: string): string {
  const parent = join(dirname(workspaceLocalPath), '.cortex-worktrees');
  return join(parent, `${basename(workspaceLocalPath)}-${sessionId}`);
}

export function worktreeBranchFor(sessionId: string): string {
  return `cortex/session-${sessionId}`;
}

// .git 존재로 git repo 판별 (workspace.ts 와 동일 기준). 비-git 워크스페이스는 worktree 불가.
export function isGitRepo(path: string): boolean {
  try {
    return existsSync(join(path, '.git'));
  } catch {
    return false;
  }
}

function git(cwd: string, args: ReadonlyArray<string>): string | null {
  try {
    return execFileSync('git', [...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
  } catch {
    return null;
  }
}

// 세션용 worktree 생성 (HEAD 기준 새 전용 브랜치). 성공 시 경로, 실패 시 null(호출부가 워크스페이스
// cwd 로 폴백). 이미 있으면 재사용(resume·재시도 안전).
export function createAgentWorktree(workspaceLocalPath: string, sessionId: string): string | null {
  if (!isGitRepo(workspaceLocalPath)) return null;
  const wt = worktreePathFor(workspaceLocalPath, sessionId);
  if (existsSync(wt)) return wt;
  const r = git(workspaceLocalPath, ['worktree', 'add', '-b', worktreeBranchFor(sessionId), wt]);
  return r === null ? null : wt;
}

// 세션 종료 시 worktree + 전용 브랜치 정리 (best-effort). 없으면 no-op — OFF 모드(생성 안 함)에선
// 항상 no-op 라 무해. 잔존 브랜치/디렉토리 누적 방지.
export function removeAgentWorktree(workspaceLocalPath: string, sessionId: string): void {
  const wt = worktreePathFor(workspaceLocalPath, sessionId);
  if (!existsSync(wt)) return;
  git(workspaceLocalPath, ['worktree', 'remove', '--force', wt]);
  git(workspaceLocalPath, ['branch', '-D', worktreeBranchFor(sessionId)]);
}
