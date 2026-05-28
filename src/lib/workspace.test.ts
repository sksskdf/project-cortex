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
