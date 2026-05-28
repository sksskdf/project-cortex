// Phase 12 — 로컬 워크스페이스 등록 + git pull 실행.
// 보안 (박제):
// - localPath 는 등록된 워크스페이스만 spawn 허용 (Phase 13 화이트리스트 패턴)
// - 임의 shell 명령 X — `git` CLI 만 + 고정 인자 (`fetch`, `pull --ff-only`)
// - timeout 30 초

import { spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
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

// 워크스페이스 등록 — path validation 후 upsert (한 프로젝트당 1개).
// validation:
// - 절대 경로 (Windows / POSIX 모두) + 부모 경로 traversal (`..`) 거부
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

  const path = input.localPath.trim();
  if (path.length === 0) return { kind: 'invalid-path', reason: '경로가 비어있습니다.' };
  if (path.includes('..')) {
    return { kind: 'invalid-path', reason: '상위 경로 참조(..)는 허용되지 않습니다.' };
  }
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
  | { kind: 'failed'; output: string };

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

  // 아직 .git 이 없으면 (빈 디렉토리/없는 경로로 등록) clone 으로 동작.
  if (!isGitRepo(ws.localPath)) {
    return cloneWorkspace(ws);
  }

  // git fetch 먼저 (안전), 그 다음 ff-only pull (충돌이면 reject).
  const fetchRes = await runGit(ws.localPath, ['fetch', '--all', '--prune']);
  if (fetchRes.code !== 0) {
    const result = `fetch 실패: ${fetchRes.output}`;
    recordResult(ws.id, result);
    return { kind: 'failed', output: result };
  }

  const pullRes = await runGit(ws.localPath, ['pull', '--ff-only']);
  const ok = pullRes.code === 0;
  const result = ok
    ? `git pull 성공: ${pullRes.output || 'Already up to date.'}`
    : `git pull 실패: ${pullRes.output}`;

  recordResult(ws.id, result);
  return ok ? { kind: 'pulled', output: result } : { kind: 'failed', output: result };
}
