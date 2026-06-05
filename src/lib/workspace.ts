// Phase 12 — 로컬 워크스페이스 등록 + git pull 실행.
// 보안 (박제):
// - localPath 는 등록된 워크스페이스만 spawn 허용 (Phase 13 화이트리스트 패턴)
// - 임의 shell 명령 X — `git` CLI 만 + 고정 인자 (`fetch`, `pull --ff-only`)
// - timeout 30 초

import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { and, eq, ne } from 'drizzle-orm';
import { db } from '@/db/client';
import { projects, workspaces } from '@/db/schema';

export type WorkspaceView = {
  id: number;
  projectId: number;
  projectSlug: string;
  localPath: string;
  lastPullAt: Date | null;
  lastPullResult: string | null;
  // .git 이 아직 없는(빈 디렉토리로 등록된) 워크스페이스 — 첫 git pull 이 clone 으로 동작.
  needsClone: boolean;
};

type WorkspaceJoinRow = {
  ws: typeof workspaces.$inferSelect;
  slug: string;
};

// .git 폴더/파일(worktree) 존재 여부 — clone 완료된 저장소인지 판별.
function isGitRepo(path: string): boolean {
  try {
    return existsSync(join(path, '.git'));
  } catch {
    return false;
  }
}

// GitHub remote URL → `owner/repo` slug. ssh(git@github.com:owner/repo) 와 https
// (https://github.com/owner/repo) 둘 다 인식. 그 외 호스트/형식은 null 반환 →
// 호출부가 검증을 skip 한다 (관대 폴백, 회귀 0).
function githubSlugFromRemoteUrl(url: string): string | null {
  const m = url
    .trim()
    .match(/^(?:git@github\.com:|https:\/\/github\.com\/)([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/);
  return m ? m[1] : null;
}

// .git 있는 디렉토리의 `git remote get-url origin` → GitHub slug. 실패/비-GitHub 는 null.
// 워크스페이스 등록 시점 1회 검증용이라 sync 동기 실행 허용.
function readGitOriginSlug(path: string): string | null {
  try {
    const url = execFileSync('git', ['-C', path, 'remote', 'get-url', 'origin'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    return githubSlugFromRemoteUrl(url);
  } catch {
    return null;
  }
}

function toView(row: WorkspaceJoinRow): WorkspaceView {
  return {
    id: row.ws.id,
    projectId: row.ws.projectId,
    projectSlug: row.slug,
    localPath: row.ws.localPath,
    lastPullAt: row.ws.lastPullAt,
    lastPullResult: row.ws.lastPullResult,
    needsClone: !isGitRepo(row.ws.localPath),
  };
}

export function getWorkspace(projectId: number): WorkspaceView | null {
  const row = db
    .select({ ws: workspaces, slug: projects.slug })
    .from(workspaces)
    .innerJoin(projects, eq(projects.id, workspaces.projectId))
    .where(eq(workspaces.projectId, projectId))
    .get();
  return row ? toView(row) : null;
}

// Phase 13 — 세션 spawn 시 workspaceId 로 cwd 화이트리스트 조회. DB 에 등록된 것만.
export function getWorkspaceById(workspaceId: number): WorkspaceView | null {
  const row = db
    .select({ ws: workspaces, slug: projects.slug })
    .from(workspaces)
    .innerJoin(projects, eq(projects.id, workspaces.projectId))
    .where(eq(workspaces.id, workspaceId))
    .get();
  return row ? toView(row) : null;
}

// Phase 13 — /agents 워크스페이스 선택용. 프로젝트 slug 순.
export function listWorkspaces(): WorkspaceView[] {
  return db
    .select({ ws: workspaces, slug: projects.slug })
    .from(workspaces)
    .innerJoin(projects, eq(projects.id, workspaces.projectId))
    .orderBy(projects.slug)
    .all()
    .map(toView);
}

export type RegisterWorkspaceResult =
  | { kind: 'registered'; id: number }
  | { kind: 'updated'; id: number }
  | { kind: 'invalid-path'; reason: string }
  | { kind: 'no-project' };

// 등록 경로 정규화 — `.`·중복 구분자 해소 + 끝 구분자 제거. trailing slash(`/a/b/`) 나
// `/a/./b` 같은 표기 차이로 같은 디렉토리가 다른 문자열이 되어 교차등록 가드·1프로젝트1워크스페이스
// upsert 를 우회하던 문제 방지(리뷰 발견). 정규화 결과가 빈 문자열이면(방어) 원본 반환.
export function normalizeWorkspacePath(p: string): string {
  const n = normalize(p).replace(/[/\\]+$/, '');
  return n.length > 0 ? n : p;
}

// 워크스페이스 등록 — path validation 후 upsert (한 프로젝트당 1개).
// validation:
// - 절대 경로 (Windows / POSIX 모두) + 부모 경로 traversal (`..` 세그먼트) 거부
// - 다음 중 하나면 허용:
//   (a) .git 있는 기존 클론  (b) 비어있는 디렉토리 (clone 대상)  (c) 존재하지 않는 경로 (clone 이 생성)
//   → 빈 디렉토리/없는 경로는 첫 git pull 이 git clone 으로 동작 (사용자가 직접 클론할 필요 없음).
// - 파일이 있는데 .git 이 없는 디렉토리는 거부 (덮어쓰기 방지).
export function registerWorkspace(input: {
  projectId: number;
  localPath: string;
}): RegisterWorkspaceResult {
  const project = db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .get();
  if (!project) return { kind: 'no-project' };

  const raw = input.localPath.trim();
  if (raw.length === 0) return { kind: 'invalid-path', reason: '경로가 비어있습니다.' };
  // `..` 는 **세그먼트 단위**로 거부 — 정규화(아래)가 `..` 를 해소해버리기 전에 원본 기준으로
  // 검사. 부분문자열(`includes('..')`)이 아니라 세그먼트라야 `/srv/foo..bar/repo` 같은 정상
  // 경로를 오거부하지 않는다(리뷰 발견).
  if (raw.split(/[/\\]+/).includes('..')) {
    return { kind: 'invalid-path', reason: '상위 경로 참조(..)는 허용되지 않습니다.' };
  }
  // 정규화 — trailing slash·`.`·중복 구분자를 단일 canonical 형태로(교차등록 가드 우회 방지).
  const path = normalizeWorkspacePath(raw);
  // 절대 경로 — POSIX (`/`) 또는 Windows (`C:\`).
  const isAbsolute = path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path);
  if (!isAbsolute) return { kind: 'invalid-path', reason: '절대 경로여야 합니다.' };

  if (existsSync(path)) {
    let isDir = false;
    try {
      isDir = statSync(path).isDirectory();
    } catch {
      isDir = false;
    }
    if (!isDir) return { kind: 'invalid-path', reason: '디렉토리가 아닙니다.' };

    // .git 없으면 빈 디렉토리만 허용 — 첫 pull 이 clone. 파일이 있으면 덮어쓰기 위험 → 거부.
    if (!isGitRepo(path)) {
      let entries: string[] = ['?'];
      try {
        entries = readdirSync(path);
      } catch {
        entries = ['?'];
      }
      if (entries.length > 0) {
        return {
          kind: 'invalid-path',
          reason: '비어있지 않은데 git 저장소도 아닙니다. 빈 폴더나 클론된 저장소를 지정하세요.',
        };
      }
    }
  }
  // 존재하지 않는 경로는 허용 — git clone 이 디렉토리를 생성한다 (부모가 없으면 clone 시 에러로 표면화).

  // 가드 1 — 다른 프로젝트가 이미 같은 localPath 에 워크스페이스를 등록했으면 거부.
  // 한 디렉토리에 두 프로젝트가 박히면 위임이 다른 repo 의 클론에서 돌고 그쪽 origin 으로 push 되는
  // 교차 등록 사고가 난다(실사례 — hunt-the-ace 워크스페이스가 cortex 디렉토리에 박혀 cortex 에 PR 푸시).
  const crossRegistered = db
    .select({ id: workspaces.id, projectId: workspaces.projectId })
    .from(workspaces)
    .where(and(eq(workspaces.localPath, path), ne(workspaces.projectId, input.projectId)))
    .get();
  if (crossRegistered) {
    return {
      kind: 'invalid-path',
      reason: '이미 다른 프로젝트의 워크스페이스로 등록된 경로입니다.',
    };
  }

  // 가드 2 — .git 있는 기존 클론이면 remote origin URL 의 GitHub slug 가 프로젝트 slug 와 매칭되는지.
  // GitHub URL 만 검증, 그 외(다른 호스트·미설정 origin)는 readGitOriginSlug 가 null → skip(관대 폴백).
  if (existsSync(path) && isGitRepo(path)) {
    const remoteSlug = readGitOriginSlug(path);
    if (remoteSlug) {
      const projectSlug = db
        .select({ slug: projects.slug })
        .from(projects)
        .where(eq(projects.id, input.projectId))
        .get()?.slug;
      if (projectSlug && remoteSlug.toLowerCase() !== projectSlug.toLowerCase()) {
        return {
          kind: 'invalid-path',
          reason: `이 디렉토리의 git remote(${remoteSlug})가 프로젝트(${projectSlug})와 다릅니다.`,
        };
      }
    }
  }

  const existing = db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.projectId, input.projectId))
    .get();

  if (existing) {
    db.update(workspaces)
      .set({ localPath: path, updatedAt: new Date() })
      .where(eq(workspaces.id, existing.id))
      .run();
    return { kind: 'updated', id: existing.id };
  }
  const inserted = db
    .insert(workspaces)
    .values({ projectId: input.projectId, localPath: path })
    .returning({ id: workspaces.id })
    .get();
  return { kind: 'registered', id: inserted.id };
}

export function deleteWorkspace(workspaceId: number): { kind: 'deleted' } | { kind: 'not-found' } {
  const existing = db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .get();
  if (!existing) return { kind: 'not-found' };
  db.delete(workspaces).where(eq(workspaces.id, workspaceId)).run();
  return { kind: 'deleted' };
}

// git CLI 실행 — 등록된 워크스페이스의 localPath 에서만. 임의 명령 X.
// 클론은 부모 경로 변동 + 네트워크라 더 넉넉히 (120s), fetch/pull 은 30s.
const GIT_TIMEOUT_MS = 30_000;
const CLONE_TIMEOUT_MS = 120_000;
const OUTPUT_MAX_CHARS = 500;

type GitRunResult = { code: number; output: string };
type GitRunner = (
  cwd: string,
  args: ReadonlyArray<string>,
  timeoutMs?: number,
) => Promise<GitRunResult>;

// 테스트 주입 — null 이면 실제 git spawn. (clone/pull 분기 검증용)
let _gitRunner: GitRunner | null = null;
export function setGitRunner(runner: GitRunner | null): void {
  _gitRunner = runner;
}

function runGit(
  cwd: string,
  args: ReadonlyArray<string>,
  timeoutMs: number = GIT_TIMEOUT_MS,
): Promise<GitRunResult> {
  if (_gitRunner) return _gitRunner(cwd, args, timeoutMs);
  return new Promise((resolve) => {
    const child = spawn('git', [...args], {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, // credential prompt 방지
    });
    let buffer = '';
    const append = (s: string) => {
      buffer += s;
      if (buffer.length > OUTPUT_MAX_CHARS * 2) {
        buffer = buffer.slice(-OUTPUT_MAX_CHARS * 2);
      }
    };
    child.stdout.on('data', (d) => append(d.toString('utf8')));
    child.stderr.on('data', (d) => append(d.toString('utf8')));
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
    }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      const output = buffer.slice(-OUTPUT_MAX_CHARS).trim();
      resolve({ code: code ?? -1, output });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: -1, output: err.message.slice(-OUTPUT_MAX_CHARS) });
    });
  });
}

export type PullResult =
  | { kind: 'pulled'; output: string }
  | { kind: 'cloned'; output: string }
  | { kind: 'no-workspace' }
  | { kind: 'skipped-in-flight' }
  | { kind: 'failed'; output: string };

// 같은 localPath 에 대한 동시 pull/clone 직렬화 — 진행 중인 경로 집합. auto-merge 의 인플라이트
// 락은 per-PR 라, 같은 repo 의 두 PR 이 거의 동시에 머지되면 같은 clone 에서 git fetch/pull 이
// 동시에 돌아 .git/index.lock·FETCH_HEAD 충돌 + 허위 실패 알림이 났다(리뷰 발견). 이미 진행
// 중이면 skip — best-effort 라 진행 중 pull 이 최신(방금 머지분 포함)을 가져오므로 재시도 불필요.
const _pullsInFlight = new Set<string>();

function recordResult(workspaceId: number, result: string): void {
  db.update(workspaces)
    .set({ lastPullAt: new Date(), lastPullResult: result, updatedAt: new Date() })
    .where(eq(workspaces.id, workspaceId))
    .run();
}

// 빈 디렉토리(또는 없는 경로)로 등록된 워크스페이스를 GitHub 에서 clone.
// 인증은 fetch/pull 과 동일하게 사용자의 ambient git credential 사용 (토큰 주입 X) —
// GIT_TERMINAL_PROMPT=0 이라 자격증명이 없으면 행 없이 에러로 표면화된다.
async function cloneWorkspace(ws: WorkspaceView): Promise<PullResult> {
  const url = `https://github.com/${ws.projectSlug}.git`;
  // cwd 는 항상 존재하는 서버 작업 디렉토리 — clone 타깃 경로는 절대경로로 지정(없으면 git 이 생성).
  const res = await runGit(process.cwd(), ['clone', url, ws.localPath], CLONE_TIMEOUT_MS);
  const ok = res.code === 0;
  const result = ok
    ? `git clone 성공: ${ws.projectSlug}`
    : `git clone 실패: ${res.output || '알 수 없는 오류'}`;
  recordResult(ws.id, result);
  return ok ? { kind: 'cloned', output: result } : { kind: 'failed', output: result };
}

export async function pullWorkspace(projectId: number): Promise<PullResult> {
  const ws = getWorkspace(projectId);
  if (!ws) return { kind: 'no-workspace' };

  // 같은 디렉토리에 동시 git 작업이 돌면 index.lock 충돌 — 이미 진행 중이면 skip(best-effort).
  if (_pullsInFlight.has(ws.localPath)) return { kind: 'skipped-in-flight' };
  _pullsInFlight.add(ws.localPath);
  try {
    // 아직 .git 이 없으면 (빈 디렉토리/없는 경로로 등록) clone 으로 동작.
    if (!isGitRepo(ws.localPath)) {
      return await cloneWorkspace(ws);
    }

    // git fetch 먼저 (안전), 그 다음 ff-only pull (충돌이면 reject).
    const fetchRes = await runGit(ws.localPath, ['fetch', '--all', '--prune']);
    if (fetchRes.code !== 0) {
      // 빈 output 폴백 — Windows 일부 환경에서 git 이 stdout/stderr 모두 침묵하는 경우 진단을
      // 위해 exit code 라도 노출(사용자 보고 패턴과 일치).
      const detail = fetchRes.output || `(no output; exit ${fetchRes.code})`;
      const result = `git fetch 실패: ${detail}`;
      recordResult(ws.id, result);
      return { kind: 'failed', output: result };
    }

    const pullRes = await runGit(ws.localPath, ['pull', '--ff-only']);
    const ok = pullRes.code === 0;
    const detail =
      pullRes.output || (ok ? 'Already up to date.' : `(no output; exit ${pullRes.code})`);
    const result = ok ? `git pull 성공: ${detail}` : `git pull --ff-only 실패: ${detail}`;

    recordResult(ws.id, result);
    return ok ? { kind: 'pulled', output: result } : { kind: 'failed', output: result };
  } finally {
    _pullsInFlight.delete(ws.localPath);
  }
}
