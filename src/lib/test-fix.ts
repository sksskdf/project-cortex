// Phase 13.x — CI 테스트 실패 시 claude CLI 로 자동 수정. conflict-resolve 의 형제 모듈.
//
// 트리거: handleCheckWebhook 가 prs.testsPassed=false (CI 실패) 를 처음 감지했을 때.
// 전략: 등록된 워크스페이스에서 PR head 브랜치를 원격 기준으로 최신화 → claude 에게 "테스트를
// 실행해 실패를 파악하고 수정" 위임(cwd 안 파일 편집) → 변경이 생기면 commit + push.
// push 가 새 CI 를 발사 → handleCheckWebhook 재진입 → testsPassed=true 면 재트라이아지+자동 머지.
//
// 안전 가드 (conflict-resolve 와 동일 선상):
// - 프로젝트 autoFixTestsEnabled 토글 ON 만 (디폴트 OFF — 명시 활성 전엔 비발화).
// - 작성자 무관(사람·agent 모두) — 단일 사용자 가정상 내 PR. 외부 기여는 fork 가드로 차단.
// - 등록된 워크스페이스(cwd 화이트리스트)에서만. fork/cross-repo 는 비대상.
// - PR 당 MAX_FIX_ATTEMPTS 회 — 고치지 못한 채 push 가 반복되는 무한 루프 차단.
// - claude 가 못 고치면(변경 없음) 또는 실패하면 워크스페이스 원복 + PR 코멘트 + 알림.
//
// ⚠️ 런타임 검증 필요: claude CLI 도구 권한(--dangerously-skip-permissions) + 로컬 테스트
// 실행/ git 흐름은 실기기/CI 에서 확인. 토글 OFF 디폴트가 안전망.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { prs, projects } from '@/db/schema';
import { runClaudeHeadless } from './claude-cli';
import { addPRComment, getPRMergeStatus } from './github';
import { logger } from './logger';
import { createNotification } from './notifications';
import { getWorkspace } from './workspace';

const GIT_TIMEOUT_MS = 60_000;
// 테스트 실행 + 수정 + 재실행이라 충돌 해결(300s)보다 넉넉히.
const CLAUDE_TIMEOUT_MS = 600_000;
const TEST_FIX_MODEL = 'claude-opus-4-7';
// 같은 PR 에 대한 자동 수정 시도 상한 — claude 가 못 고친 채 push 가 반복되는 루프 차단.
const MAX_FIX_ATTEMPTS = 2;

export type TestFixResult =
  | { kind: 'fixed' }
  | {
      kind: 'skipped';
      reason:
        | 'disabled'
        | 'no-pr'
        | 'no-project'
        | 'no-installation'
        | 'no-workspace'
        | 'workspace-missing'
        | 'fork-or-cross-repo'
        | 'max-attempts';
    }
  | { kind: 'failed'; reason: string };

type GitResult = { code: number; stdout: string; stderr: string };
type GitRunner = (cwd: string, args: ReadonlyArray<string>) => Promise<GitResult>;

// 테스트 주입 — null 이면 실제 git spawn.
let _gitRunner: GitRunner | null = null;
export function setGitRunner(runner: GitRunner | null): void {
  _gitRunner = runner;
}
function git(cwd: string, args: ReadonlyArray<string>): Promise<GitResult> {
  return (_gitRunner ?? realGit)(cwd, args);
}

function realGit(cwd: string, args: ReadonlyArray<string>): Promise<GitResult> {
  return new Promise((resolve) => {
    const child = spawn('git', [...args], {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), GIT_TIMEOUT_MS);
    child.stdout.on('data', (d) => (stdout += d.toString('utf8')));
    child.stderr.on('data', (d) => (stderr += d.toString('utf8')));
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr + err.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

// PR 당 자동 수정 시도 횟수 (in-process). 프로세스 재시작 시 리셋 — 안전망 성격.
const fixAttempts = new Map<number, number>();

// 테스트용 — 시도 카운터 리셋.
export function resetFixAttempts(): void {
  fixAttempts.clear();
}

export async function attemptTestFix(prId: number): Promise<TestFixResult> {
  const pr = db.select().from(prs).where(eq(prs.id, prId)).get();
  if (!pr) return { kind: 'skipped', reason: 'no-pr' };

  const project = db.select().from(projects).where(eq(projects.id, pr.repoId)).get();
  if (!project) return { kind: 'skipped', reason: 'no-project' };
  if (project.installationId === null) return { kind: 'skipped', reason: 'no-installation' };
  if (!project.autoFixTestsEnabled) return { kind: 'skipped', reason: 'disabled' };

  // 작성자 무관 — 단일 사용자 가정상 사람 PR 도 내 PR. 외부 기여(fork)는 아래 가드로 차단.
  const workspace = getWorkspace(project.id);
  if (!workspace) return { kind: 'skipped', reason: 'no-workspace' };
  if (!existsSync(workspace.localPath)) return { kind: 'skipped', reason: 'workspace-missing' };

  const [owner, repo] = project.slug.split('/');
  const status = await getPRMergeStatus(project.installationId, { owner, repo }, pr.number);

  // fork/cross-repo 는 head 브랜치를 base 레포 클론에서 직접 push 못 함.
  if (status.headRepoFullName !== `${owner}/${repo}`) {
    return { kind: 'skipped', reason: 'fork-or-cross-repo' };
  }

  const attempts = fixAttempts.get(prId) ?? 0;
  if (attempts >= MAX_FIX_ATTEMPTS) {
    await comment(
      project.installationId,
      { owner, repo },
      pr.number,
      `자동 테스트 수정을 ${MAX_FIX_ATTEMPTS}회 시도했지만 CI 가 계속 실패합니다 — 사람 검토가 필요합니다.`,
    );
    safeNotify(prId, '자동 테스트 수정 최대 시도 초과.');
    return { kind: 'skipped', reason: 'max-attempts' };
  }
  fixAttempts.set(prId, attempts + 1);

  const cwd = workspace.localPath;
  const { headRef } = status;

  // 1) 최신화 + head 브랜치를 원격 head 로 정렬 + 이전 시도 잔재 정리.
  const fetched = await git(cwd, ['fetch', 'origin', '--prune']);
  if (fetched.code !== 0) {
    return fail(
      prId,
      project.installationId,
      { owner, repo },
      pr.number,
      `git fetch 실패: ${tail(fetched.stderr)}`,
    );
  }
  const checkedOut = await git(cwd, ['checkout', '-B', headRef, `origin/${headRef}`]);
  if (checkedOut.code !== 0) {
    return fail(
      prId,
      project.installationId,
      { owner, repo },
      pr.number,
      `git checkout 실패: ${tail(checkedOut.stderr)}`,
    );
  }
  await git(cwd, ['reset', '--hard', `origin/${headRef}`]);
  await git(cwd, ['clean', '-fd']);

  // 2) 테스트 실행·수정을 claude 에 위임 (cwd 안 파일 편집). 커밋·푸시는 Cortex 가 결정적으로.
  const fixed = await runClaudeHeadless({
    input: testFixPrompt(project.slug, headRef),
    instruction:
      '현재 작업 디렉토리에서 테스트를 실행해 실패를 파악하고 수정하세요. 테스트가 통과할 때까지 고치되, 커밋·푸시는 하지 말고 변경만 남기세요.',
    model: TEST_FIX_MODEL,
    cwd,
    dangerouslyAllowAllTools: true,
    timeoutMs: CLAUDE_TIMEOUT_MS,
  });
  if (!fixed.ok) {
    await restore(cwd, headRef);
    return fail(
      prId,
      project.installationId,
      { owner, repo },
      pr.number,
      `claude 테스트 수정 실패: ${fixed.reason}`,
    );
  }

  // 3) claude 가 실제로 변경을 남겼는지 — 없으면 고치지 못한 것으로 본다.
  const changes = await git(cwd, ['status', '--porcelain']);
  if (changes.stdout.trim() === '') {
    return fail(
      prId,
      project.installationId,
      { owner, repo },
      pr.number,
      'claude 가 테스트를 수정하지 못했습니다 (변경 없음).',
    );
  }

  // 4) 커밋 + push. push 가 새 CI 를 발사 → 재트라이아지+머지 흐름으로 이어짐.
  await git(cwd, ['add', '-A']);
  const committed = await git(cwd, [
    '-c',
    'core.editor=true',
    'commit',
    '-m',
    'fix: 자동 테스트 수정 (Cortex)',
  ]);
  if (committed.code !== 0) {
    await restore(cwd, headRef);
    return fail(
      prId,
      project.installationId,
      { owner, repo },
      pr.number,
      `테스트 수정 커밋 실패: ${tail(committed.stderr)}`,
    );
  }
  const pushed = await git(cwd, ['push', 'origin', headRef]);
  if (pushed.code !== 0) {
    return fail(
      prId,
      project.installationId,
      { owner, repo },
      pr.number,
      `git push 실패: ${tail(pushed.stderr)}`,
    );
  }

  logger.info({ source: 'test-fix', prId, headRef }, 'tests auto-fixed and pushed');
  return { kind: 'fixed' };
}

function testFixPrompt(slug: string, headRef: string): string {
  return [
    `저장소 ${slug} 의 PR 브랜치 '${headRef}' 에서 CI 테스트가 실패했습니다.`,
    `현재 작업 디렉토리가 그 저장소의 로컬 클론이며 '${headRef}' 가 체크아웃돼 있습니다.`,
    ``,
    `다음을 수행하세요:`,
    `- 이 저장소의 테스트 명령(package.json scripts 등)을 찾아 실행하고 실패를 파악하세요.`,
    `- 실패 원인을 고치세요. 가능하면 구현 코드를 고쳐 테스트를 통과시키고, 테스트가 잘못된`,
    `  경우에만 테스트를 수정하세요.`,
    `- 수정 후 테스트를 다시 실행해 통과하는지 확인하세요.`,
    `- 실패와 무관한 코드는 건드리지 마세요.`,
    `- 파일만 편집하세요. git add/commit/push 는 하지 마세요 (Cortex 가 처리).`,
    `- 안전하게 고칠 수 없으면 추측하지 말고 그대로 두세요 (Cortex 가 사람에게 넘깁니다).`,
  ].join('\n');
}

// 실패 시 워크스페이스를 원격 head 기준으로 원복 — claude 의 부분 편집 잔재 제거.
async function restore(cwd: string, headRef: string): Promise<void> {
  await git(cwd, ['reset', '--hard', `origin/${headRef}`]);
  await git(cwd, ['clean', '-fd']);
}

// 실패 공통 처리 — PR 코멘트 + alert 알림 + 로깅.
async function fail(
  prId: number,
  installationId: number,
  ref: { owner: string; repo: string },
  number: number,
  reason: string,
): Promise<TestFixResult> {
  logger.error({ source: 'test-fix', prId, reason }, 'test fix failed');
  await comment(
    installationId,
    ref,
    number,
    `자동 테스트 수정에 실패했습니다 — 사람 검토가 필요합니다.\n\n사유: ${reason}`,
  );
  safeNotify(prId, reason);
  return { kind: 'failed', reason };
}

async function comment(
  installationId: number,
  ref: { owner: string; repo: string },
  number: number,
  body: string,
): Promise<void> {
  try {
    await addPRComment(installationId, ref, number, body);
  } catch (err) {
    logger.error({ source: 'test-fix', number, err }, 'addPRComment failed');
  }
}

// 전용 알림 kind 가 없어 'auto-merge-failed' 재사용 (자동 머지 진행 불가 통지 — conflict-resolve 와 동일).
function safeNotify(prId: number, reason: string): void {
  try {
    createNotification({ kind: 'auto-merge-failed', prId, reason });
  } catch (err) {
    logger.error({ source: 'test-fix', prId, err }, 'createNotification failed');
  }
}

function tail(s: string): string {
  return s.slice(-300).trim();
}
