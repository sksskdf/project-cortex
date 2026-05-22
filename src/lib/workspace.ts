// Phase 12 — 로컬 워크스페이스 등록 + git pull 실행.
// 보안 (박제):
// - localPath 는 등록된 워크스페이스만 spawn 허용 (Phase 13 화이트리스트 패턴)
// - 임의 shell 명령 X — `git` CLI 만 + 고정 인자 (`fetch`, `pull --ff-only`)
// - timeout 30 초

import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
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
};

export function getWorkspace(projectId: number): WorkspaceView | null {
  const row = db
    .select({
      ws: workspaces,
      slug: projects.slug,
    })
    .from(workspaces)
    .innerJoin(projects, eq(projects.id, workspaces.projectId))
    .where(eq(workspaces.projectId, projectId))
    .get();
  if (!row) return null;
  return {
    id: row.ws.id,
    projectId: row.ws.projectId,
    projectSlug: row.slug,
    localPath: row.ws.localPath,
    lastPullAt: row.ws.lastPullAt,
    lastPullResult: row.ws.lastPullResult,
  };
}

export type RegisterWorkspaceResult =
  | { kind: 'registered'; id: number }
  | { kind: 'updated'; id: number }
  | { kind: 'invalid-path'; reason: string }
  | { kind: 'no-project' };

// 워크스페이스 등록 — path validation 후 upsert (한 프로젝트당 1개).
// validation:
// - 절대 경로 (Windows / POSIX 모두)
// - 디렉토리 존재 + .git 폴더 존재
// - 부모 경로 traversal (`..`) 거부
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
  if (!existsSync(path)) return { kind: 'invalid-path', reason: '경로가 존재하지 않습니다.' };

  let isDir = false;
  try {
    isDir = statSync(path).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) return { kind: 'invalid-path', reason: '디렉토리가 아닙니다.' };

  // .git 폴더 또는 파일 (worktree) 확인.
  const gitMarker = `${path.replace(/[\\/]$/, '')}/.git`;
  const gitMarkerWin = `${path.replace(/[\\/]$/, '')}\\.git`;
  if (!existsSync(gitMarker) && !existsSync(gitMarkerWin)) {
    return { kind: 'invalid-path', reason: 'git 저장소가 아닙니다 (.git 없음).' };
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
// 30 초 timeout. stdout + stderr 합쳐서 마지막 500자만 반환 (저장용).
const GIT_TIMEOUT_MS = 30_000;
const OUTPUT_MAX_CHARS = 500;

function runGit(
  cwd: string,
  args: ReadonlyArray<string>,
): Promise<{
  code: number;
  output: string;
}> {
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
    }, GIT_TIMEOUT_MS);
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
  | { kind: 'no-workspace' }
  | { kind: 'failed'; output: string };

export async function pullWorkspace(projectId: number): Promise<PullResult> {
  const ws = getWorkspace(projectId);
  if (!ws) return { kind: 'no-workspace' };

  // git fetch 먼저 (안전), 그 다음 ff-only pull (충돌이면 reject).
  const fetchRes = await runGit(ws.localPath, ['fetch', '--all', '--prune']);
  if (fetchRes.code !== 0) {
    const result = `fetch 실패: ${fetchRes.output}`;
    db.update(workspaces)
      .set({ lastPullAt: new Date(), lastPullResult: result, updatedAt: new Date() })
      .where(eq(workspaces.id, ws.id))
      .run();
    return { kind: 'failed', output: result };
  }

  const pullRes = await runGit(ws.localPath, ['pull', '--ff-only']);
  const ok = pullRes.code === 0;
  const result = ok
    ? `git pull 성공: ${pullRes.output || 'Already up to date.'}`
    : `git pull 실패: ${pullRes.output}`;

  db.update(workspaces)
    .set({ lastPullAt: new Date(), lastPullResult: result, updatedAt: new Date() })
    .where(eq(workspaces.id, ws.id))
    .run();

  return ok ? { kind: 'pulled', output: result } : { kind: 'failed', output: result };
}
