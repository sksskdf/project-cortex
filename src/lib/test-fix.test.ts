import type { Octokit } from '@octokit/rest';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/client';
import { notifications, prs, projects, workspaces } from '@/db/schema';
import { setClaudeRunner } from './claude-cli';
import { setOctokit } from './github';
import { attemptTestFix, resetFixAttempts, setGitRunner } from './test-fix';

// 워크스페이스 localPath 는 실제 존재해야 함(existsSync 가드) — 항상 있는 cwd 사용.
// git 은 setGitRunner 로 mock 하므로 실제 명령은 안 돈다.
const WS_PATH = process.cwd();

type GitResult = { code: number; stdout: string; stderr: string };

function ok(stdout = ''): GitResult {
  return { code: 0, stdout, stderr: '' };
}
function nonzero(stderr = 'err'): GitResult {
  return { code: 1, stdout: '', stderr };
}

// pulls.get 가 getPRMergeStatus 에 head/base/full_name 을 제공.
function mockOctokit(opts: { headRef?: string; headFullName?: string }): Octokit {
  return {
    pulls: {
      get: vi.fn().mockResolvedValue({
        data: {
          mergeable_state: 'unstable',
          mergeable: true,
          head: {
            ref: opts.headRef ?? 'feature',
            repo: { full_name: opts.headFullName ?? 'acme/web' },
          },
          base: { ref: 'main' },
        },
      }),
    },
    issues: { createComment: vi.fn().mockResolvedValue({ data: { id: 1 } }) },
  } as unknown as Octokit;
}

beforeAll(() => {
  migrate(db, { migrationsFolder: 'src/db/migrations' });
});

beforeEach(() => {
  resetFixAttempts();
  db.delete(notifications).run();
  db.delete(workspaces).run();
  db.delete(prs).run();
  db.delete(projects).run();
});

afterEach(() => {
  setOctokit(null);
  setGitRunner(null);
  setClaudeRunner(null);
});

function setup(opts: {
  autoFix?: boolean;
  authorKind?: 'agent' | 'human';
  withWorkspace?: boolean;
}) {
  const project = db
    .insert(projects)
    .values({
      slug: 'acme/web',
      name: 'Web',
      installationId: 12345,
      autoMergeEnabled: true,
      autoFixTestsEnabled: opts.autoFix ?? true,
    })
    .returning({ id: projects.id })
    .get();
  if (opts.withWorkspace ?? true) {
    db.insert(workspaces).values({ projectId: project.id, localPath: WS_PATH }).run();
  }
  const pr = db
    .insert(prs)
    .values({
      repoId: project.id,
      number: 42,
      title: 'Auto PR',
      authorKind: opts.authorKind ?? 'agent',
      authorId: 'devin',
      headSha: 'sha-x',
      linesAdded: 10,
      linesRemoved: 1,
      filesChanged: 1,
      status: 'review-needed',
      testsPassed: false,
    })
    .returning({ id: prs.id })
    .get();
  return pr.id;
}

describe('attemptTestFix — guards', () => {
  it('토글 OFF 면 skip disabled (GitHub 호출 0)', async () => {
    const octokit = mockOctokit({});
    setOctokit(octokit);
    const prId = setup({ autoFix: false });

    const r = await attemptTestFix(prId);
    expect(r).toEqual({ kind: 'skipped', reason: 'disabled' });
    expect(octokit.pulls.get).not.toHaveBeenCalled();
  });

  it('사람 PR 도 수정 대상 (작성자 무관) — 단일 사용자 가정', async () => {
    setOctokit(mockOctokit({ headRef: 'feature' }));
    setClaudeRunner(vi.fn().mockResolvedValue({ ok: true, text: 'done' }));
    const git = vi.fn((_cwd: string, args: ReadonlyArray<string>): Promise<GitResult> => {
      if (args.includes('status') && args.includes('--porcelain')) {
        return Promise.resolve(ok(' M src/x.ts\n'));
      }
      return Promise.resolve(ok());
    });
    setGitRunner(git);
    const r = await attemptTestFix(setup({ authorKind: 'human' }));
    expect(r).toEqual({ kind: 'fixed' });
  });

  it('워크스페이스 미등록이면 skip no-workspace', async () => {
    setOctokit(mockOctokit({}));
    const prId = setup({ withWorkspace: false });
    const r = await attemptTestFix(prId);
    expect(r).toEqual({ kind: 'skipped', reason: 'no-workspace' });
  });

  // 리뷰 발견 가드(conflict-resolve 와 동일 클래스): 긴 수정 동안 사람이 PR 을 머지/닫으면
  // push 직전 재확인이 죽은 브랜치 push·잘못된 'tests-fixed' 알림을 막는다.
  it('수정 중 PR 이 머지되면 push 생략 (skip pr-closed)', async () => {
    setOctokit(mockOctokit({ headRef: 'feature' }));
    const prId = setup({});
    // claude 수정이 끝나는 순간 머지된 것으로 시뮬레이션.
    setClaudeRunner(
      vi.fn().mockImplementation(async () => {
        db.update(prs).set({ status: 'merged' }).where(eq(prs.id, prId)).run();
        return { ok: true, text: 'done' };
      }),
    );
    const pushArgs: string[][] = [];
    const git = vi.fn((_cwd: string, args: ReadonlyArray<string>): Promise<GitResult> => {
      if (args.includes('push')) {
        pushArgs.push([...args]);
        return Promise.resolve(ok());
      }
      if (args.includes('status') && args.includes('--porcelain')) {
        return Promise.resolve(ok(' M src/x.ts\n'));
      }
      return Promise.resolve(ok());
    });
    setGitRunner(git);

    const r = await attemptTestFix(prId);
    expect(r).toEqual({ kind: 'skipped', reason: 'pr-closed' });
    expect(pushArgs).toHaveLength(0);
    expect(
      db.select().from(notifications).where(eq(notifications.kind, 'tests-fixed')).all(),
    ).toHaveLength(0);
  });

  it('fork/cross-repo 면 skip', async () => {
    setOctokit(mockOctokit({ headFullName: 'someone/fork' }));
    const prId = setup({});
    const r = await attemptTestFix(prId);
    expect(r).toEqual({ kind: 'skipped', reason: 'fork-or-cross-repo' });
  });
});

describe('attemptTestFix — 수정 흐름', () => {
  it('테스트 수정 성공 → fixed (claude 호출 + commit + push)', async () => {
    setOctokit(mockOctokit({ headRef: 'feature' }));
    const claude = vi.fn().mockResolvedValue({ ok: true, text: 'done' });
    setClaudeRunner(claude);
    const git = vi.fn((_cwd: string, args: ReadonlyArray<string>): Promise<GitResult> => {
      // status --porcelain 은 변경 있음으로 응답해야 commit 단계로 진행.
      if (args.includes('status') && args.includes('--porcelain')) {
        return Promise.resolve(ok(' M src/x.ts\n'));
      }
      return Promise.resolve(ok());
    });
    setGitRunner(git);

    const r = await attemptTestFix(setup({}));

    expect(r).toEqual({ kind: 'fixed' });
    expect(claude).toHaveBeenCalledTimes(1);
    expect(claude.mock.calls[0][0].dangerouslyAllowAllTools).toBe(true);
    // R2 — Cortex 가드레일을 시스템 프롬프트로 주입.
    expect(claude.mock.calls[0][0].appendSystemPrompt).toContain('Cortex 작업 가드레일');
    const pushed = git.mock.calls.some((c) => c[1].includes('push') && c[1].includes('feature'));
    expect(pushed).toBe(true);
    const committed = git.mock.calls.some((c) => c[1].includes('commit'));
    expect(committed).toBe(true);
  });

  it('claude 가 변경을 안 남기면 → failed (커밋 안 함 + PR 코멘트)', async () => {
    const octokit = mockOctokit({});
    setOctokit(octokit);
    setClaudeRunner(vi.fn().mockResolvedValue({ ok: true, text: 'done' }));
    const git = vi.fn((_cwd: string, args: ReadonlyArray<string>): Promise<GitResult> => {
      if (args.includes('status') && args.includes('--porcelain')) return Promise.resolve(ok(''));
      return Promise.resolve(ok());
    });
    setGitRunner(git);

    const r = await attemptTestFix(setup({}));
    expect(r.kind).toBe('failed');
    expect(octokit.issues.createComment).toHaveBeenCalledTimes(1);
    const committed = git.mock.calls.some((c) => c[1].includes('commit'));
    expect(committed).toBe(false);
  });

  it('claude 실패 → failed + 워크스페이스 원복 + PR 코멘트', async () => {
    const octokit = mockOctokit({});
    setOctokit(octokit);
    setClaudeRunner(vi.fn().mockResolvedValue({ ok: false, reason: 'claude 없음' }));
    const git = vi.fn().mockResolvedValue(ok());
    setGitRunner(git);

    const r = await attemptTestFix(setup({}));
    expect(r.kind).toBe('failed');
    expect(octokit.issues.createComment).toHaveBeenCalledTimes(1);
    const restored = git.mock.calls.some((c) => c[1].includes('reset') && c[1].includes('--hard'));
    expect(restored).toBe(true);
  });

  it('최대 시도 횟수 초과 시 skip max-attempts', async () => {
    setOctokit(mockOctokit({}));
    setClaudeRunner(vi.fn().mockResolvedValue({ ok: true, text: 'done' }));
    const git = vi.fn((_cwd: string, args: ReadonlyArray<string>): Promise<GitResult> => {
      if (args.includes('status') && args.includes('--porcelain')) {
        return Promise.resolve(ok(' M src/x.ts\n'));
      }
      return Promise.resolve(ok());
    });
    setGitRunner(git);

    const prId = setup({});
    await attemptTestFix(prId); // 1
    await attemptTestFix(prId); // 2
    const r = await attemptTestFix(prId); // 3 — 초과
    expect(r).toEqual({ kind: 'skipped', reason: 'max-attempts' });
  });
});
