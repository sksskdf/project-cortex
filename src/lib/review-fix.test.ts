import type { Octokit } from '@octokit/rest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/client';
import { notifications, prs, projects, workspaces } from '@/db/schema';
import { setClaudeRunner } from './claude-cli';
import { setOctokit } from './github';
import { attemptAddressReview, resetReviewAttempts, setGitRunner } from './review-fix';

// 워크스페이스 localPath 는 실제 존재해야 함(existsSync 가드). git 은 setGitRunner 로 mock.
const WS_PATH = process.cwd();

type GitResult = { code: number; stdout: string; stderr: string };
function ok(stdout = ''): GitResult {
  return { code: 0, stdout, stderr: '' };
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
  resetReviewAttempts();
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
  autoResolve?: boolean;
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
      autoResolveChangesEnabled: opts.autoResolve ?? true,
    })
    .returning({ id: projects.id })
    .get();
  if (opts.withWorkspace ?? true) {
    db.insert(workspaces).values({ projectId: project.id, localPath: WS_PATH }).run();
  }
  db.insert(prs)
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
      testsPassed: true,
    })
    .run();
}

const input = {
  repoSlug: 'acme/web',
  prNumber: 42,
  feedback: '버튼 색을 디자인 토큰으로 바꿔주세요',
  reviewer: 'owner',
};

describe('attemptAddressReview — guards', () => {
  it('토글 OFF 면 skip disabled (GitHub 호출 0)', async () => {
    const octokit = mockOctokit({});
    setOctokit(octokit);
    setup({ autoResolve: false });

    const r = await attemptAddressReview(input);
    expect(r).toEqual({ kind: 'skipped', reason: 'disabled' });
    expect(octokit.pulls.get).not.toHaveBeenCalled();
  });

  it('프로젝트 미등록이면 skip no-project', async () => {
    setOctokit(mockOctokit({}));
    const r = await attemptAddressReview({ ...input, repoSlug: 'no/such' });
    expect(r).toEqual({ kind: 'skipped', reason: 'no-project' });
  });

  it('사람 PR 이면 skip human-pr', async () => {
    setOctokit(mockOctokit({}));
    setup({ authorKind: 'human' });
    const r = await attemptAddressReview(input);
    expect(r).toEqual({ kind: 'skipped', reason: 'human-pr' });
  });

  it('리뷰 본문이 비면 skip no-feedback', async () => {
    setOctokit(mockOctokit({}));
    setup({});
    const r = await attemptAddressReview({ ...input, feedback: '   ' });
    expect(r).toEqual({ kind: 'skipped', reason: 'no-feedback' });
  });

  it('워크스페이스 미등록이면 skip no-workspace', async () => {
    setOctokit(mockOctokit({}));
    setup({ withWorkspace: false });
    const r = await attemptAddressReview(input);
    expect(r).toEqual({ kind: 'skipped', reason: 'no-workspace' });
  });

  it('fork/cross-repo 면 skip', async () => {
    setOctokit(mockOctokit({ headFullName: 'someone/fork' }));
    setup({});
    const r = await attemptAddressReview(input);
    expect(r).toEqual({ kind: 'skipped', reason: 'fork-or-cross-repo' });
  });
});

describe('attemptAddressReview — 반영 흐름', () => {
  it('성공 → addressed (claude 호출 + 피드백 전달 + commit + push)', async () => {
    setOctokit(mockOctokit({ headRef: 'feature' }));
    const claude = vi.fn().mockResolvedValue({ ok: true, text: 'done' });
    setClaudeRunner(claude);
    const git = vi.fn((_cwd: string, args: ReadonlyArray<string>): Promise<GitResult> => {
      if (args.includes('status') && args.includes('--porcelain')) {
        return Promise.resolve(ok(' M src/x.ts\n'));
      }
      return Promise.resolve(ok());
    });
    setGitRunner(git);
    setup({});

    const r = await attemptAddressReview(input);

    expect(r).toEqual({ kind: 'addressed' });
    expect(claude).toHaveBeenCalledTimes(1);
    expect(claude.mock.calls[0][0].dangerouslyAllowAllTools).toBe(true);
    expect(claude.mock.calls[0][0].input).toContain('버튼 색을 디자인 토큰으로 바꿔주세요');
    expect(git.mock.calls.some((c) => c[1].includes('push') && c[1].includes('feature'))).toBe(
      true,
    );
    expect(git.mock.calls.some((c) => c[1].includes('commit'))).toBe(true);
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
    setup({});

    const r = await attemptAddressReview(input);
    expect(r.kind).toBe('failed');
    expect(octokit.issues.createComment).toHaveBeenCalledTimes(1);
    expect(git.mock.calls.some((c) => c[1].includes('commit'))).toBe(false);
  });

  it('claude 실패 → failed + 워크스페이스 원복 + PR 코멘트', async () => {
    const octokit = mockOctokit({});
    setOctokit(octokit);
    setClaudeRunner(vi.fn().mockResolvedValue({ ok: false, reason: 'claude 없음' }));
    const git = vi.fn().mockResolvedValue(ok());
    setGitRunner(git);
    setup({});

    const r = await attemptAddressReview(input);
    expect(r.kind).toBe('failed');
    expect(octokit.issues.createComment).toHaveBeenCalledTimes(1);
    expect(git.mock.calls.some((c) => c[1].includes('reset') && c[1].includes('--hard'))).toBe(
      true,
    );
  });

  it('최대 시도 횟수(3) 초과 시 skip max-attempts', async () => {
    setOctokit(mockOctokit({}));
    setClaudeRunner(vi.fn().mockResolvedValue({ ok: true, text: 'done' }));
    const git = vi.fn((_cwd: string, args: ReadonlyArray<string>): Promise<GitResult> => {
      if (args.includes('status') && args.includes('--porcelain')) {
        return Promise.resolve(ok(' M src/x.ts\n'));
      }
      return Promise.resolve(ok());
    });
    setGitRunner(git);
    setup({});

    await attemptAddressReview(input); // 1
    await attemptAddressReview(input); // 2
    await attemptAddressReview(input); // 3
    const r = await attemptAddressReview(input); // 4 — 초과
    expect(r).toEqual({ kind: 'skipped', reason: 'max-attempts' });
  });
});
