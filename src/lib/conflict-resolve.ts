// Phase 13.2 — 자동 머지 중 충돌(dirty) 발생 시 claude CLI 로 자동 해결.
//
// 전략 (로드맵의 rebase+force-push 에서 변경): base 를 head 브랜치에 **merge** 한다.
// 근거 — 프로젝트가 squash 머지라 머지 커밋은 최종 머지 때 어차피 소멸 + **force-push 불필요**
// 라 원격 커밋을 덮어쓸 위험이 0 (blast radius 최소). git 조작은 Cortex 가 결정적으로 하고,
// 충돌 파일의 마커 해소만 claude 에 위임한다 (claude 가 임의 git 명령을 돌리지 않음).
//
// 안전 가드 (박제):
// - 프로젝트 autoResolveConflictsEnabled 토글 ON 만 (디폴트 OFF — 명시 활성 전엔 비발화).
// - 작성자 무관(사람·agent 모두) — 단일 사용자 가정상 내 PR. 외부 기여는 fork 가드로 차단.
// - 등록된 워크스페이스(cwd 화이트리스트)에서만. fork/cross-repo 는 비대상.
// - 충돌 파일 수 한계 초과 시 사람 검토 (의도 충돌 가능성 큼).
// - claude 가 마커를 다 못 지우면(잔존 마커) 실패 처리 + merge --abort.
// - 실패 시 merge --abort 로 워크스페이스 원복 + PR 코멘트 + alert 알림.
//
// ⚠️ 런타임 검증 필요: claude CLI 도구 권한(--dangerously-skip-permissions) 및 로컬 git
// 흐름은 실기기/CI 에서 확인해야 함. 토글 OFF 디폴트가 안전망.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { prs, projects } from '@/db/schema';
import { runClaudeHeadless } from './claude-cli';
import { allowedToolsFor } from './cli-permissions';
import { CORTEX_HEADLESS_GUIDANCE } from './cortex-skill';
import { getSettings } from './settings';
import { setAutomationInFlight, clearAutomationInFlight } from './automation-state';
import { addPRComment, getPRMergeStatus, isUntrustedAuthorAssociation } from './github';
import { logger } from './logger';
import { createNotification } from './notifications';
import { getWorkspace } from './workspace';

// 충돌 파일이 이 수를 넘으면 자동 해결 안 함 (의도 충돌 가능성 ↑ → 사람 검토).
const MAX_CONFLICT_FILES = 10;
const GIT_TIMEOUT_MS = 60_000;
const CLAUDE_TIMEOUT_MS = 300_000;
const CONFLICT_RESOLVE_MODEL = 'claude-opus-4-7';

export type ConflictResolveResult =
  | { kind: 'resolved' }
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
        | 'not-dirty'
        | 'too-large'
        | 'pr-closed'
        | 'untrusted-author';
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

export async function attemptConflictResolution(prId: number): Promise<ConflictResolveResult> {
  const pr = db.select().from(prs).where(eq(prs.id, prId)).get();
  if (!pr) return { kind: 'skipped', reason: 'no-pr' };
  // 이미 머지/닫힌 PR(late/중복 webhook)은 수 분짜리 claude 작업을 통째로 낭비하므로 시작 시 skip
  // (push 직전 가드와 대칭 — 양 끝에서 끝난 PR 방어).
  if (pr.status === 'merged' || pr.status === 'closed') {
    return { kind: 'skipped', reason: 'pr-closed' };
  }
  // 외부 기여자 PR(위조 불가 author_association)은 자동화 대상 아님 — 그들의 코드를 체크아웃해
  // skip-permissions 로 claude 를 돌리고 push 하는 건 신뢰 작업이라 레포 멤버/협업자 PR 로 한정.
  // null(legacy·PAT)이면 미적용(무회귀). fork 가드(아래)와 별개의 권한 게이트.
  if (isUntrustedAuthorAssociation(pr.authorAssociation)) {
    return { kind: 'skipped', reason: 'untrusted-author' };
  }

  const project = db.select().from(projects).where(eq(projects.id, pr.repoId)).get();
  if (!project) return { kind: 'skipped', reason: 'no-project' };
  if (project.installationId === null) return { kind: 'skipped', reason: 'no-installation' };
  if (!project.autoResolveConflictsEnabled) return { kind: 'skipped', reason: 'disabled' };

  // 작성자 무관 — 단일 사용자 가정상 사람 PR 도 내 PR. 외부 기여(fork)는 아래 가드로 차단.
  const workspace = getWorkspace(project.id);
  if (!workspace) return { kind: 'skipped', reason: 'no-workspace' };
  if (!existsSync(workspace.localPath)) return { kind: 'skipped', reason: 'workspace-missing' };

  const [owner, repo] = project.slug.split('/');
  const status = await getPRMergeStatus(project.installationId, { owner, repo }, pr.number);

  // fork/cross-repo 는 base 레포 클론에서 head 브랜치를 직접 push 못 함.
  if (status.headRepoFullName !== `${owner}/${repo}`) {
    return { kind: 'skipped', reason: 'fork-or-cross-repo' };
  }
  // 충돌(dirty) 이 아니면 해결할 게 없음 — auto-merge 가 처리하도록 둠.
  if (status.mergeableState !== 'dirty') return { kind: 'skipped', reason: 'not-dirty' };

  const cwd = workspace.localPath;
  const { headRef, baseRef } = status;

  // 1) 최신화 + head 브랜치를 원격 head 로 정렬.
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

  // 2) base 를 head 에 merge (core.editor=true 로 머지 메시지 에디터 진입 방지).
  const merged = await git(cwd, [
    '-c',
    'core.editor=true',
    'merge',
    '--no-edit',
    `origin/${baseRef}`,
  ]);

  // 충돌 없이 머지된 경우 — 바로 push.
  if (merged.code === 0) {
    return pushHead(prId, project.installationId, { owner, repo }, pr.number, cwd, headRef);
  }

  // 3) 충돌 파일 수집 + 한계 검사.
  const unmerged = await git(cwd, ['diff', '--name-only', '--diff-filter=U']);
  const conflictFiles = unmerged.stdout
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  if (conflictFiles.length === 0) {
    // merge 가 비정상 종료했지만 충돌 목록이 비어있음 — 알 수 없는 상태. 원복.
    await git(cwd, ['merge', '--abort']);
    return fail(
      prId,
      project.installationId,
      { owner, repo },
      pr.number,
      `git merge 실패(충돌 목록 없음): ${tail(merged.stderr)}`,
    );
  }
  if (conflictFiles.length > MAX_CONFLICT_FILES) {
    await git(cwd, ['merge', '--abort']);
    await comment(
      project.installationId,
      { owner, repo },
      pr.number,
      `자동 충돌 해결을 건너뜁니다 — 충돌 파일이 ${conflictFiles.length}개로 한계(${MAX_CONFLICT_FILES})를 초과했습니다. 사람 검토가 필요합니다.`,
    );
    safeNotify(prId, '충돌 파일 과다 — 사람 검토 필요.');
    return { kind: 'skipped', reason: 'too-large' };
  }

  // 4) 충돌 파일 마커 해소를 claude 에 위임 (cwd 안에서 파일 편집).
  // in-flight 표시 시작 — 종료는 pushHead/fail(터미널 헬퍼)에서 clear.
  setAutomationInFlight(prId, 'resolving-conflict');
  const resolved = await runClaudeHeadless({
    input: conflictPrompt(project.slug, baseRef, headRef, conflictFiles),
    instruction:
      '현재 작업 디렉토리의 머지 충돌을 해결하세요. 충돌 마커가 있는 파일을 편집해 양쪽 의도를 모두 보존하고 모든 충돌 마커를 제거하세요. 커밋·푸시는 하지 마세요.',
    model: CONFLICT_RESOLVE_MODEL,
    cwd,
    // R4 권한 정밀화 — 토글 ON 이면 작업별 좁은 허용목록만, OFF 면 기존 dangerously 폴백(무회귀).
    allowedTools: allowedToolsFor('conflict-resolve', getSettings().cliAllowedToolsEnabled),
    dangerouslyAllowAllTools: true,
    appendSystemPrompt: CORTEX_HEADLESS_GUIDANCE,
    timeoutMs: CLAUDE_TIMEOUT_MS,
  });
  if (!resolved.ok) {
    await git(cwd, ['merge', '--abort']);
    return fail(
      prId,
      project.installationId,
      { owner, repo },
      pr.number,
      `claude 충돌 해결 실패: ${resolved.reason}`,
    );
  }

  // 5) 해소 검증 — 스테이징 후 잔존 충돌 마커 검사. 남아 있으면 실패 + 원복.
  // `git diff --cached --check` 는 충돌 마커뿐 아니라 공백 오류(trailing whitespace,
  // blank-line-at-EOF, space-before-tab)도 nonzero 로 같이 보고한다. 그래서 exit code 로만 판단하면
  // 정상 해결됐는데 흔한 공백 오류가 한 줄만 있어도 false-fail → merge --abort 로 해결 작업이 날아가
  // 자동 해결이 결코 성공할 수 없는 PR(공백 오류 있는 레포)이 생긴다(리뷰 발견). stdout 의 "leftover
  // conflict marker" 문구(git 영문 고정 — i18n 안 됨)로 마커만 콕 찝어 검사한다. nonzero+마커문구
  // 부재 = 공백 오류뿐 → 통과.
  await git(cwd, ['add', '-A']);
  const markerCheck = await git(cwd, ['diff', '--cached', '--check']);
  if (markerCheck.code !== 0 && /leftover conflict marker/i.test(markerCheck.stdout)) {
    await git(cwd, ['merge', '--abort']);
    return fail(
      prId,
      project.installationId,
      { owner, repo },
      pr.number,
      '충돌 마커가 남아 있어 머지를 중단했습니다.',
    );
  }

  // 6) 머지 커밋 완료.
  const committed = await git(cwd, ['-c', 'core.editor=true', 'commit', '--no-edit']);
  if (committed.code !== 0) {
    await git(cwd, ['merge', '--abort']);
    return fail(
      prId,
      project.installationId,
      { owner, repo },
      pr.number,
      `머지 커밋 실패: ${tail(committed.stderr)}`,
    );
  }

  return pushHead(prId, project.installationId, { owner, repo }, pr.number, cwd, headRef);
}

// head 브랜치 push (force 아님 — origin/head 기반이라 fast-forward). push 후 GitHub 가
// synchronize webhook 발사 → Cortex 재분석 → 재트라이아지 → 자동 머지 재시도.
async function pushHead(
  prId: number,
  installationId: number,
  ref: { owner: string; repo: string },
  number: number,
  cwd: string,
  headRef: string,
): Promise<ConflictResolveResult> {
  // 긴 충돌 해결(수 분, claude CLI) 동안 사람이 PR 을 머지/닫았을 수 있다. 그 사이 webhook 으로
  // DB status 가 갱신됐으면 이미 끝난 PR 의 브랜치에 push 하지 않는다 — 죽은 브랜치 부활·잘못된
  // 'conflict-resolved' 알림 방지(리뷰 발견). push 직전 최신 status 재확인(방어적 가드).
  const cur = db.select({ status: prs.status }).from(prs).where(eq(prs.id, prId)).get();
  if (cur && (cur.status === 'merged' || cur.status === 'closed')) {
    clearAutomationInFlight(prId);
    logger.info(
      { source: 'conflict-resolve', prId, status: cur.status },
      'PR 이 해결 중 머지/닫힘 — push 생략',
    );
    return { kind: 'skipped', reason: 'pr-closed' };
  }
  const pushed = await git(cwd, ['push', 'origin', headRef]);
  if (pushed.code !== 0) {
    return fail(prId, installationId, ref, number, `git push 실패: ${tail(pushed.stderr)}`);
  }
  logger.info({ source: 'conflict-resolve', prId, headRef }, 'conflict resolved and pushed');
  clearAutomationInFlight(prId);
  // 성공도 알림 — 사용자가 "Cortex 가 충돌을 자동 해결했다"를 인지 (이전엔 조용).
  try {
    createNotification({ kind: 'conflict-resolved', prId });
  } catch (err) {
    logger.error({ source: 'conflict-resolve', prId, err }, 'createNotification(success) failed');
  }
  return { kind: 'resolved' };
}

function conflictPrompt(
  slug: string,
  baseRef: string,
  headRef: string,
  files: ReadonlyArray<string>,
): string {
  return [
    `저장소 ${slug} 의 PR 브랜치 '${headRef}' 에 base 브랜치 '${baseRef}' 를 머지하던 중 충돌이 발생했습니다.`,
    `현재 작업 디렉토리가 그 저장소의 로컬 클론이며, 아래 파일들에 충돌 마커가 있습니다:`,
    ...files.map((f) => `- ${f}`),
    ``,
    `각 충돌을 해결하세요:`,
    `- 양쪽(base/head) 변경 의도를 모두 이해하고 둘 다 보존되도록 합치세요.`,
    `- 충돌과 무관한 코드는 건드리지 마세요.`,
    `- <<<<<<<, =======, >>>>>>> 충돌 마커를 전부 제거하세요.`,
    `- 파일만 편집하세요. git add/commit/push 는 하지 마세요 (Cortex 가 처리).`,
    `- 의미가 충돌해 안전히 합칠 수 없으면, 추측하지 말고 그대로 두세요 (Cortex 가 사람에게 넘깁니다).`,
  ].join('\n');
}

// 실패 공통 처리 — PR 코멘트 + alert 알림 + 로깅.
async function fail(
  prId: number,
  installationId: number,
  ref: { owner: string; repo: string },
  number: number,
  reason: string,
): Promise<ConflictResolveResult> {
  logger.error({ source: 'conflict-resolve', prId, reason }, 'conflict resolution failed');
  clearAutomationInFlight(prId);
  await comment(
    installationId,
    ref,
    number,
    `자동 충돌 해결에 실패했습니다 — 사람 검토가 필요합니다.\n\n사유: ${reason}`,
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
    logger.error({ source: 'conflict-resolve', number, err }, 'addPRComment failed');
  }
}

function safeNotify(prId: number, reason: string): void {
  try {
    createNotification({ kind: 'conflict-resolve-failed', prId, reason });
  } catch (err) {
    logger.error({ source: 'conflict-resolve', prId, err }, 'createNotification failed');
  }
}

function tail(s: string): string {
  return s.slice(-300).trim();
}
