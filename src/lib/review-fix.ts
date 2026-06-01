// Phase 13.1 — PR 에 "변경 요청(changes_requested)" 리뷰가 오면 claude CLI 로 자동 반영.
// test-fix(13.3)·conflict-resolve(13.2) 의 형제 모듈 — 같은 안전 가드·git 흐름.
//
// 트리거: webhook 라우트의 handleReview → attemptAddressReview (best-effort 백그라운드).
// 전략: 등록된 워크스페이스에서 PR head 브랜치를 원격 기준으로 최신화 → claude 에게 "리뷰
// 피드백을 코드에 반영" 위임(cwd 안 파일 편집) → 변경이 생기면 commit + push.
// push 가 새 CI/재트라이아지를 발사 → 자동 머지 흐름으로 이어짐.
//
// 안전 가드 (test-fix 와 동일 선상):
// - 프로젝트 autoResolveChangesEnabled 토글 ON 만 (디폴트 OFF — 명시 활성 전엔 비발화).
// - 작성자 무관(사람·agent 모두) — 단일 사용자 가정상 내 PR. 외부 기여는 fork 가드로 차단.
// - 리뷰 본문이 비어 있으면 비발화 (반영할 지시가 없음).
// - 등록된 워크스페이스(cwd 화이트리스트)에서만. fork/cross-repo 는 비대상.
// - PR 당 MAX_FIX_ATTEMPTS 회 — 못 고친 채 push 가 반복되는 루프 차단.
// - claude 가 변경을 안 남기거나 실패하면 워크스페이스 원복 + PR 코멘트 + 알림.
//
// ⚠️ 런타임 검증 필요: claude CLI 도구 권한(--dangerously-skip-permissions) + git 흐름은
// 실기기에서 확인. 토글 OFF 디폴트가 안전망.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { prs, projects } from '@/db/schema';
import { runClaudeHeadless } from './claude-cli';
import { CORTEX_HEADLESS_GUIDANCE } from './cortex-skill';
import { setAutomationInFlight, clearAutomationInFlight } from './automation-state';
import { addPRComment, getPRMergeStatus } from './github';
import { logger } from './logger';
import { createNotification } from './notifications';
import { getWorkspace } from './workspace';

const GIT_TIMEOUT_MS = 60_000;
const CLAUDE_TIMEOUT_MS = 600_000;
const REVIEW_FIX_MODEL = 'claude-opus-4-7';
// 리뷰 반영은 왕복(추가 변경 요청)이 잦을 수 있어 test-fix(2)보다 살짝 여유.
const MAX_FIX_ATTEMPTS = 3;

export type ReviewFixInput = {
  repoSlug: string;
  prNumber: number;
  feedback: string;
  reviewer: string;
};

export type ReviewFixResult =
  | { kind: 'addressed' }
  | {
      kind: 'skipped';
      reason:
        | 'disabled'
        | 'no-project'
        | 'no-installation'
        | 'no-pr'
        | 'no-feedback'
        | 'no-workspace'
        | 'workspace-missing'
        | 'fork-or-cross-repo'
        | 'max-attempts'
        | 'pr-closed';
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

// PR 당 자동 반영 시도 횟수 (in-process). 프로세스 재시작 시 리셋 — 안전망 성격.
const fixAttempts = new Map<number, number>();

// 테스트용 — 시도 카운터 리셋.
export function resetReviewAttempts(): void {
  fixAttempts.clear();
}

export async function attemptAddressReview(input: ReviewFixInput): Promise<ReviewFixResult> {
  const project = db.select().from(projects).where(eq(projects.slug, input.repoSlug)).get();
  if (!project) return { kind: 'skipped', reason: 'no-project' };
  if (project.installationId === null) return { kind: 'skipped', reason: 'no-installation' };
  if (!project.autoResolveChangesEnabled) return { kind: 'skipped', reason: 'disabled' };

  const pr = db
    .select()
    .from(prs)
    .where(and(eq(prs.repoId, project.id), eq(prs.number, input.prNumber)))
    .get();
  if (!pr) return { kind: 'skipped', reason: 'no-pr' };

  // 작성자 무관 — 단일 사용자 가정상 사람 PR 도 내 PR. 외부 기여(fork)는 아래 가드로 차단.
  const feedback = input.feedback.trim();
  if (feedback === '') return { kind: 'skipped', reason: 'no-feedback' };

  const workspace = getWorkspace(project.id);
  if (!workspace) return { kind: 'skipped', reason: 'no-workspace' };
  if (!existsSync(workspace.localPath)) return { kind: 'skipped', reason: 'workspace-missing' };

  const [owner, repo] = project.slug.split('/');
  const status = await getPRMergeStatus(project.installationId, { owner, repo }, pr.number);

  // fork/cross-repo 는 head 브랜치를 base 레포 클론에서 직접 push 못 함.
  if (status.headRepoFullName !== `${owner}/${repo}`) {
    return { kind: 'skipped', reason: 'fork-or-cross-repo' };
  }

  const attempts = fixAttempts.get(pr.id) ?? 0;
  if (attempts >= MAX_FIX_ATTEMPTS) {
    await comment(
      project.installationId,
      { owner, repo },
      pr.number,
      `변경 요청을 ${MAX_FIX_ATTEMPTS}회 자동 반영했지만 리뷰가 계속 변경을 요청합니다 — 사람 검토가 필요합니다.`,
    );
    safeNotify(pr.id, '자동 변경 반영 최대 시도 초과.');
    return { kind: 'skipped', reason: 'max-attempts' };
  }
  fixAttempts.set(pr.id, attempts + 1);

  const cwd = workspace.localPath;
  const { headRef } = status;

  // 1) 최신화 + head 브랜치를 원격 head 로 정렬 + 이전 시도 잔재 정리.
  const fetched = await git(cwd, ['fetch', 'origin', '--prune']);
  if (fetched.code !== 0) {
    return fail(
      pr.id,
      project.installationId,
      { owner, repo },
      pr.number,
      `git fetch 실패: ${tail(fetched.stderr)}`,
    );
  }
  const checkedOut = await git(cwd, ['checkout', '-B', headRef, `origin/${headRef}`]);
  if (checkedOut.code !== 0) {
    return fail(
      pr.id,
      project.installationId,
      { owner, repo },
      pr.number,
      `git checkout 실패: ${tail(checkedOut.stderr)}`,
    );
  }
  await git(cwd, ['reset', '--hard', `origin/${headRef}`]);
  await git(cwd, ['clean', '-fd']);

  // 2) 리뷰 피드백 반영을 claude 에 위임 (cwd 안 파일 편집). 커밋·푸시는 Cortex 가 결정적으로.
  // in-flight 표시 시작 — 종료는 성공 return / fail(터미널)에서 clear.
  setAutomationInFlight(pr.id, 'addressing-review');
  const fixed = await runClaudeHeadless({
    input: reviewFixPrompt(project.slug, headRef, feedback),
    instruction:
      '현재 작업 디렉토리에서 아래 리뷰 피드백이 요청한 변경만 반영하세요. 커밋·푸시는 하지 말고 변경만 남기세요.',
    model: REVIEW_FIX_MODEL,
    cwd,
    dangerouslyAllowAllTools: true,
    appendSystemPrompt: CORTEX_HEADLESS_GUIDANCE,
    timeoutMs: CLAUDE_TIMEOUT_MS,
  });
  if (!fixed.ok) {
    await restore(cwd, headRef);
    return fail(
      pr.id,
      project.installationId,
      { owner, repo },
      pr.number,
      `claude 변경 반영 실패: ${fixed.reason}`,
    );
  }

  // 3) claude 가 실제로 변경을 남겼는지 — 없으면 반영 못 한 것으로 본다.
  const changes = await git(cwd, ['status', '--porcelain']);
  if (changes.stdout.trim() === '') {
    return fail(
      pr.id,
      project.installationId,
      { owner, repo },
      pr.number,
      'claude 가 리뷰 변경 요청을 반영하지 못했습니다 (변경 없음).',
    );
  }

  // 4) 커밋 + push. push 가 새 CI/재트라이아지를 발사.
  await git(cwd, ['add', '-A']);
  const committed = await git(cwd, [
    '-c',
    'core.editor=true',
    'commit',
    '-m',
    'fix: 리뷰 변경 요청 반영 (Cortex)',
  ]);
  if (committed.code !== 0) {
    await restore(cwd, headRef);
    return fail(
      pr.id,
      project.installationId,
      { owner, repo },
      pr.number,
      `변경 반영 커밋 실패: ${tail(committed.stderr)}`,
    );
  }
  // 긴 변경 반영(수 분, claude CLI) 동안 사람이 PR 을 머지/닫았을 수 있다. webhook 으로 DB
  // status 가 갱신됐으면 끝난 PR 의 브랜치에 push 하지 않는다 — 죽은 브랜치 부활·잘못된
  // 'review-addressed' 알림 방지(conflict-resolve·test-fix 와 동일 가드).
  const cur = db.select({ status: prs.status }).from(prs).where(eq(prs.id, pr.id)).get();
  if (cur && (cur.status === 'merged' || cur.status === 'closed')) {
    await restore(cwd, headRef);
    clearAutomationInFlight(pr.id);
    logger.info(
      { source: 'review-fix', prId: pr.id, status: cur.status },
      'PR 이 반영 중 머지/닫힘 — push 생략',
    );
    return { kind: 'skipped', reason: 'pr-closed' };
  }
  const pushed = await git(cwd, ['push', 'origin', headRef]);
  if (pushed.code !== 0) {
    return fail(
      pr.id,
      project.installationId,
      { owner, repo },
      pr.number,
      `git push 실패: ${tail(pushed.stderr)}`,
    );
  }

  logger.info(
    { source: 'review-fix', prId: pr.id, headRef },
    'review changes auto-addressed and pushed',
  );
  clearAutomationInFlight(pr.id);
  try {
    createNotification({ kind: 'review-addressed', prId: pr.id });
  } catch (err) {
    logger.error({ source: 'review-fix', prId: pr.id, err }, 'createNotification(success) failed');
  }
  return { kind: 'addressed' };
}

function reviewFixPrompt(slug: string, headRef: string, feedback: string): string {
  return [
    `저장소 ${slug} 의 PR 브랜치 '${headRef}' 에 변경 요청(changes_requested) 리뷰가 왔습니다.`,
    `현재 작업 디렉토리가 그 저장소의 로컬 클론이며 '${headRef}' 가 체크아웃돼 있습니다.`,
    ``,
    `리뷰 피드백:`,
    `"""`,
    feedback,
    `"""`,
    ``,
    `다음을 수행하세요:`,
    `- 위 피드백에서 요청한 변경을 코드에 반영하세요.`,
    `- 피드백과 무관한 코드는 건드리지 마세요.`,
    `- 가능하면 이 저장소의 테스트를 실행해 변경이 기존 동작을 깨지 않는지 확인하세요.`,
    `- 파일만 편집하세요. git add/commit/push 는 하지 마세요 (Cortex 가 처리).`,
    `- 피드백이 모호하거나 안전하게 반영할 수 없으면 추측하지 말고 그대로 두세요 (Cortex 가 사람에게 넘깁니다).`,
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
): Promise<ReviewFixResult> {
  logger.error({ source: 'review-fix', prId, reason }, 'review auto-address failed');
  clearAutomationInFlight(prId);
  await comment(
    installationId,
    ref,
    number,
    `변경 요청 자동 반영에 실패했습니다 — 사람 검토가 필요합니다.\n\n사유: ${reason}`,
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
    logger.error({ source: 'review-fix', number, err }, 'addPRComment failed');
  }
}

// 리뷰 자동 반영 실패 전용 알림.
function safeNotify(prId: number, reason: string): void {
  try {
    createNotification({ kind: 'review-fix-failed', prId, reason });
  } catch (err) {
    logger.error({ source: 'review-fix', prId, err }, 'createNotification failed');
  }
}

function tail(s: string): string {
  return s.slice(-300).trim();
}
