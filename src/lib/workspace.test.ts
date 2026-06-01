import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/client';
import { projects, workspaces } from '@/db/schema';
import { getWorkspace, pullWorkspace, registerWorkspace, setGitRunner } from './workspace';

beforeAll(() => {
  migrate(db, { migrationsFolder: 'src/db/migrations' });
});

beforeEach(() => {
  db.delete(workspaces).run();
  db.delete(projects).run();
});

afterEach(() => {
  setGitRunner(null);
});

function seedProject(slug = 'acme/web'): number {
  return db.insert(projects).values({ slug, name: slug }).returning({ id: projects.id }).get().id;
}

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'cortex-ws-'));
}

describe('registerWorkspace path validation', () => {
  it('rejects relative path / parent traversal / empty', () => {
    const projectId = seedProject();
    expect(registerWorkspace({ projectId, localPath: '' }).kind).toBe('invalid-path');
    expect(registerWorkspace({ projectId, localPath: 'relative/dir' }).kind).toBe('invalid-path');
    expect(registerWorkspace({ projectId, localPath: '/some/../etc' }).kind).toBe('invalid-path');
  });

  it('returns no-project when project missing', () => {
    expect(registerWorkspace({ projectId: 9999, localPath: '/tmp/x' }).kind).toBe('no-project');
  });

  it('registers an existing .git repo', () => {
    const projectId = seedProject();
    const dir = tmpDir();
    mkdirSync(join(dir, '.git'));
    const r = registerWorkspace({ projectId, localPath: dir });
    expect(r.kind).toBe('registered');
    expect(getWorkspace(projectId)!.needsClone).toBe(false);
  });

  it('registers an empty directory (clone target) with needsClone=true', () => {
    const projectId = seedProject();
    const dir = tmpDir();
    const r = registerWorkspace({ projectId, localPath: dir });
    expect(r.kind).toBe('registered');
    expect(getWorkspace(projectId)!.needsClone).toBe(true);
  });

  it('registers a non-existent path (clone will create it)', () => {
    const projectId = seedProject();
    const dir = join(tmpDir(), 'not-yet');
    const r = registerWorkspace({ projectId, localPath: dir });
    expect(r.kind).toBe('registered');
    expect(getWorkspace(projectId)!.needsClone).toBe(true);
  });

  it('rejects a non-empty directory without .git (avoid clobbering)', () => {
    const projectId = seedProject();
    const dir = tmpDir();
    writeFileSync(join(dir, 'README.md'), 'hi');
    const r = registerWorkspace({ projectId, localPath: dir });
    expect(r.kind).toBe('invalid-path');
  });

  // 가드 1 — 같은 디렉토리에 두 프로젝트 등록 방지 (교차 등록 사고 박제).
  it('rejects when localPath is already a workspace of another project', () => {
    const a = seedProject('owner/a');
    const b = seedProject('owner/b');
    const dir = tmpDir();
    mkdirSync(join(dir, '.git'));
    expect(registerWorkspace({ projectId: a, localPath: dir }).kind).toBe('registered');
    const r = registerWorkspace({ projectId: b, localPath: dir });
    expect(r.kind).toBe('invalid-path');
    if (r.kind === 'invalid-path') {
      expect(r.reason).toMatch(/다른 프로젝트/);
    }
  });

  // 가드 1 음성 — 같은 projectId 재등록(update)은 통과해야 한다 (회귀 가드).
  it('allows re-registering the same path for the same project (update)', () => {
    const projectId = seedProject('owner/a');
    const dir = tmpDir();
    mkdirSync(join(dir, '.git'));
    expect(registerWorkspace({ projectId, localPath: dir }).kind).toBe('registered');
    expect(registerWorkspace({ projectId, localPath: dir }).kind).toBe('updated');
  });

  // 가드 2 — .git 클론의 GitHub remote slug 가 프로젝트 slug 와 다르면 거부.
  it('rejects a .git clone whose GitHub origin slug differs from project slug', () => {
    const projectId = seedProject('owner/web');
    const dir = tmpDir();
    // 실제 git init + GitHub URL remote 설정 (테스트도 실제 git 사용).
    execFileSync('git', ['init', '-q', '-b', 'main', dir]);
    execFileSync('git', [
      '-C',
      dir,
      'remote',
      'add',
      'origin',
      'https://github.com/other/repo.git',
    ]);
    const r = registerWorkspace({ projectId, localPath: dir });
    expect(r.kind).toBe('invalid-path');
    if (r.kind === 'invalid-path') {
      expect(r.reason).toMatch(/other\/repo/);
      expect(r.reason).toMatch(/owner\/web/);
    }
  });

  // 가드 2 음성 — slug 매칭 OR 비-GitHub URL(skip) 이면 통과.
  it('allows .git clone when origin slug matches, or when remote is not GitHub (skip)', () => {
    // 매칭
    const a = seedProject('owner/web');
    const dirA = tmpDir();
    execFileSync('git', ['init', '-q', '-b', 'main', dirA]);
    execFileSync('git', [
      '-C',
      dirA,
      'remote',
      'add',
      'origin',
      'https://github.com/owner/web.git',
    ]);
    expect(registerWorkspace({ projectId: a, localPath: dirA }).kind).toBe('registered');

    // 비-GitHub → skip → 허용 (GitLab 등 사용자 자유)
    const b = seedProject('owner/internal');
    const dirB = tmpDir();
    execFileSync('git', ['init', '-q', '-b', 'main', dirB]);
    execFileSync('git', ['-C', dirB, 'remote', 'add', 'origin', 'https://gitlab.com/x/y.git']);
    expect(registerWorkspace({ projectId: b, localPath: dirB }).kind).toBe('registered');

    // .git 만 있고 origin 미설정 → readGitOriginSlug 가 null → skip → 허용 (기존 테스트 호환).
    const c = seedProject('owner/bare');
    const dirC = tmpDir();
    mkdirSync(join(dirC, '.git'));
    expect(registerWorkspace({ projectId: c, localPath: dirC }).kind).toBe('registered');
  });
});

describe('pullWorkspace clone vs pull branching', () => {
  it('clones when workspace has no .git yet', async () => {
    const projectId = seedProject('acme/web');
    const dir = tmpDir(); // empty → needsClone
    registerWorkspace({ projectId, localPath: dir });

    const calls: string[][] = [];
    setGitRunner(async (_cwd, args) => {
      calls.push([...args]);
      return { code: 0, output: 'done' };
    });

    const res = await pullWorkspace(projectId);
    expect(res.kind).toBe('cloned');
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('clone');
    expect(calls[0][1]).toBe('https://github.com/acme/web.git');
    expect(calls[0][2]).toBe(dir);
  });

  it('fetch + pull when .git exists', async () => {
    const projectId = seedProject();
    const dir = tmpDir();
    mkdirSync(join(dir, '.git'));
    registerWorkspace({ projectId, localPath: dir });

    const calls: string[][] = [];
    setGitRunner(async (_cwd, args) => {
      calls.push([...args]);
      return { code: 0, output: 'Already up to date.' };
    });

    const res = await pullWorkspace(projectId);
    expect(res.kind).toBe('pulled');
    expect(calls.map((c) => c[0])).toEqual(['fetch', 'pull']);
  });

  it('reports failed when clone exits non-zero', async () => {
    const projectId = seedProject();
    registerWorkspace({ projectId, localPath: tmpDir() });
    setGitRunner(async () => ({ code: 128, output: 'fatal: auth' }));

    const res = await pullWorkspace(projectId);
    expect(res.kind).toBe('failed');
  });

  it('returns no-workspace when none registered', async () => {
    const projectId = seedProject();
    expect((await pullWorkspace(projectId)).kind).toBe('no-workspace');
  });
});
