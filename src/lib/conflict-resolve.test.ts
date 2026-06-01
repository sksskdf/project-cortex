import type { Octokit } from '@octokit/rest';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/client';
import { notifications, prs, projects, workspaces } from '@/db/schema';
import { setClaudeRunner } from './claude-cli';
import { attemptConflictResolution, setGitRunner } from './conflict-resolve';
import { setOctokit } from './github';

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

// pulls.get 가 getPRMergeStatus 에 mergeable_state·head·base 를 제공.
function mockOctokit(opts: {
  mergeableState: string;
  headRef?: string;
  baseRef?: string;
  headFullName?: string;
}): Octokit {
  return {
    pulls: {
      get: vi.fn().mockResolvedValue({
        data: {
          mergeable_state: opts.mergeableState,
          mergeable: opts.mergeableState === 'dirty' ? false : true,
          head: {
            ref: opts.headRef ?? 'feature',
            repo: { full_name: opts.headFullName ?? 'acme/web' },
          },
          base: { ref: opts.baseRef ?? 'main' },
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
  slug?: string;
}) {
  const project = db
    .insert(projects)
    .values({
      slug: opts.slug ?? 'acme/web',
      name: 'Web',
      installationId: 12345,
      autoMergeEnabled: true,
      autoResolveConflictsEnabled: opts.autoResolve ?? true,
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
      status: 'auto-mergeable',
    })
    .returning({ id: prs.id })
    .get();
  return pr.id;
}

describe('attemptConflictResolution — guards', () => {
  // 이미 머지/닫힌 PR 은 시작 시 skip — GitHub 호출 0 (낭비 방지).
  it('이미 머지된 PR 은 시작 시 skip pr-closed (GitHub 호출 0)', async () => {
    const octokit = mockOctokit({ mergeableState: 'dirty' });
    setOctokit(octokit);
    const prId = setup({});
    db.update(prs).set({ status: 'merged' }).where(eq(prs.id, prId)).run();
    const r = await attemptConflictResolution(prId);
    expect(r).toEqual({ kind: 'skipped', reason: 'pr-closed' });
    expect(octokit.pulls.get).not.toHaveBeenCalled();
  });

  // 보안: 외부 기여자(위조 불가 author_association) PR 은 자동화 대상 아님 — GitHub/claude 호출 0.
  it('외부 기여자 PR 은 skip untrusted-author (claude/GitHub 호출 0)', async () => {
    const octokit = mockOctokit({ mergeableState: 'dirty' });
    setOctokit(octokit);
    const prId = setup({});
    db.update(prs).set({ authorAssociation: 'NONE' }).where(eq(prs.id, prId)).run();
    const r = await attemptConflictResolution(prId);
    expect(r).toEqual({ kind: 'skipped', reason: 'untrusted-author' });
    expect(octokit.pulls.get).not.toHaveBeenCalled();
  });

  it('토글 OFF 면 skip disabled (GitHub 호출 0)', async () => {
    const octokit = mockOctokit({ mergeableState: 'dirty' });
    setOctokit(octokit);
    const prId = setup({ autoResolve: false });

    const r = await attemptConflictResolution(prId);
    expect(r).toEqual({ kind: 'skipped', reason: 'disabled' });
    expect(octokit.pulls.get).not.toHaveBeenCalled();
  });

  it('사람 PR 도 충돌 해결 대상 (작성자 무관) — 단일 사용자 가정', async () => {
    setOctokit(mockOctokit({ mergeableState: 'dirty', headRef: 'feature' }));
    setClaudeRunner(vi.fn().mockResolvedValue({ ok: true, text: 'done' }));
    const git = vi.fn((_cwd: string, args: ReadonlyArray<string>): Promise<GitResult> => {
      if (args.includes('merge') && args.includes('--no-edit') && !args.includes('--abort')) {
        return Promise.resolve(nonzero('CONFLICT'));
      }
      if (args.includes('--diff-filter=U')) return Promise.resolve(ok('src/x.ts\n'));
      return Promise.resolve(ok());
    });
    setGitRunner(git);
    const prId = setup({ authorKind: 'human' });
    const r = await attemptConflictResolution(prId);
    expect(r).toEqual({ kind: 'resolved' });
  });

  // 리뷰 발견: 긴 충돌 해결 동안 사람이 PR 을 머지/닫으면(webhook 으로 DB status 갱신), push 직전
  // 가드가 죽은 브랜치 push·잘못된 'conflict-resolved' 알림을 막는다.
  it('해결 중 PR 이 머지되면 push 생략 (skip pr-closed, git push 안 함)', async () => {
    setOctokit(mockOctokit({ mergeableState: 'dirty', headRef: 'feature' }));
    const prId = setup({ authorKind: 'human' });
    // claude 해결이 끝나는 순간 사람이 머지한 것으로 시뮬레이션 — status 를 merged 로 갱신.
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
      if (args.includes('merge') && args.includes('--no-edit') && !args.includes('--abort')) {
        return Promise.resolve(nonzero('CONFLICT'));
      }
      if (args.includes('--diff-filter=U')) return Promise.resolve(ok('src/x.ts\n'));
      return Promise.resolve(ok());
    });
    setGitRunner(git);

    const r = await attemptConflictResolution(prId);
    expect(r).toEqual({ kind: 'skipped', reason: 'pr-closed' });
    // git push 가 호출되지 않았는지 (죽은 브랜치 부활 방지).
    expect(pushArgs).toHaveLength(0);
    // 잘못된 'conflict-resolved' 알림 없음.
    expect(
      db.select().from(notifications).where(eq(notifications.kind, 'conflict-resolved')).all(),
    ).toHaveLength(0);
  });

  it('워크스페이스 미등록이면 skip no-workspace', async () => {
    setOctokit(mockOctokit({ mergeableState: 'dirty' }));
    const prId = setup({ withWorkspace: false });
    const r = await attemptConflictResolution(prId);
    expect(r).toEqual({ kind: 'skipped', reason: 'no-workspace' });
  });

  it('충돌(dirty) 아니면 skip not-dirty', async () => {
    setOctokit(mockOctokit({ mergeableState: 'clean' }));
    const prId = setup({});
    const r = await attemptConflictResolution(prId);
    expect(r).toEqual({ kind: 'skipped', reason: 'not-dirty' });
  });

  it('fork/cross-repo 면 skip', async () => {
    setOctokit(mockOctokit({ mergeableState: 'dirty', headFullName: 'someone/fork' }));
    const prId = setup({});
    const r = await attemptConflictResolution(prId);
    expect(r).toEqual({ kind: 'skipped', reason: 'fork-or-cross-repo' });
  });
});

describe('attemptConflictResolution — 해결 흐름', () => {
  it('충돌 해결 성공 → resolved (claude 호출 + push)', async () => {
    setOctokit(mockOctokit({ mergeableState: 'dirty', headRef: 'feature' }));
    const claude = vi.fn().mockResolvedValue({ ok: true, text: 'done' });
    setClaudeRunner(claude);
    const git = vi.fn((_cwd: string, args: ReadonlyArray<string>): Promise<GitResult> => {
      if (args.includes('merge') && args.includes('--no-edit') && !args.includes('--abort')) {
        return Promise.resolve(nonzero('CONFLICT')); // 머지 충돌
      }
      if (args.includes('--diff-filter=U')) return Promise.resolve(ok('src/x.ts\n'));
      return Promise.resolve(ok()); // fetch/checkout/add/--check/commit/push 모두 성공
    });
    setGitRunner(git);

    const prId = setup({});
    const r = await attemptConflictResolution(prId);

    expect(r).toEqual({ kind: 'resolved' });
    expect(claude).toHaveBeenCalledTimes(1);
    expect(claude.mock.calls[0][0].dangerouslyAllowAllTools).toBe(true);
    // push origin feature 가 호출됐는지.
    const pushed = git.mock.calls.some((c) => c[1].includes('push') && c[1].includes('feature'));
    expect(pushed).toBe(true);
    // 성공도 알림으로 표면화 (자동화 가시성).
    const notifs = db.select().from(notifications).all();
    expect(notifs.some((n) => n.kind === 'conflict-resolved')).toBe(true);
  });

  it('충돌 파일이 한계를 넘으면 skip too-large + merge --abort', async () => {
    setOctokit(mockOctokit({ mergeableState: 'dirty' }));
    setClaudeRunner(vi.fn());
    const manyFiles = Array.from({ length: 11 }, (_, i) => `src/f${i}.ts`).join('\n');
    const git = vi.fn((_cwd: string, args: ReadonlyArray<string>): Promise<GitResult> => {
      if (args.includes('merge') && args.includes('--no-edit')) return Promise.resolve(nonzero());
      if (args.includes('--diff-filter=U')) return Promise.resolve(ok(manyFiles));
      return Promise.resolve(ok());
    });
    setGitRunner(git);

    const r = await attemptConflictResolution(setup({}));
    expect(r).toEqual({ kind: 'skipped', reason: 'too-large' });
    const aborted = git.mock.calls.some((c) => c[1].includes('merge') && c[1].includes('--abort'));
    expect(aborted).toBe(true);
  });

  it('claude 해결 실패 → failed + merge --abort + PR 코멘트', async () => {
    const octokit = mockOctokit({ mergeableState: 'dirty' });
    setOctokit(octokit);
    setClaudeRunner(vi.fn().mockResolvedValue({ ok: false, reason: 'claude 없음' }));
    const git = vi.fn((_cwd: string, args: ReadonlyArray<string>): Promise<GitResult> => {
      if (args.includes('merge') && args.includes('--no-edit')) return Promise.resolve(nonzero());
      if (args.includes('--diff-filter=U')) return Promise.resolve(ok('src/x.ts\n'));
      return Promise.resolve(ok());
    });
    setGitRunner(git);

    const r = await attemptConflictResolution(setup({}));
    expect(r.kind).toBe('failed');
    expect(octokit.issues.createComment).toHaveBeenCalledTimes(1);
    const aborted = git.mock.calls.some((c) => c[1].includes('merge') && c[1].includes('--abort'));
    expect(aborted).toBe(true);
  });

  it('잔존 충돌 마커(diff --check 실패) → failed', async () => {
    setOctokit(mockOctokit({ mergeableState: 'dirty' }));
    setClaudeRunner(vi.fn().mockResolvedValue({ ok: true, text: 'done' }));
    const git = vi.fn((_cwd: string, args: ReadonlyArray<string>): Promise<GitResult> => {
      if (args.includes('merge') && args.includes('--no-edit') && !args.includes('--abort')) {
        return Promise.resolve(nonzero());
      }
      if (args.includes('--diff-filter=U')) return Promise.resolve(ok('src/x.ts\n'));
      // git 실제 출력: 마커 잔존 시 stdout 에 "leftover conflict marker" 줄.
      if (args.includes('--check')) {
        return Promise.resolve({
          code: 2,
          stdout: 'src/x.ts:1: leftover conflict marker\n',
          stderr: '',
        });
      }
      return Promise.resolve(ok());
    });
    setGitRunner(git);

    const r = await attemptConflictResolution(setup({}));
    expect(r.kind).toBe('failed');
  });

  // 리뷰 발견: `git diff --check` 는 충돌 마커뿐 아니라 공백 오류(trailing whitespace 등)에도
  // nonzero 를 반환한다. 예전엔 exit code 만 봐서, 정상 해결된 머지가 흔한 공백 오류 한 줄 때문에
  // false-fail → abort → 영영 해결 불가 PR 이 됐다. 이제는 stdout 의 "leftover conflict marker"
  // 문구로만 판단해, 공백 오류뿐인 경우는 통과시키고 정상 push 한다.
  it('공백 오류만 있는 diff --check nonzero 는 통과 (정상 push) — false-fail 회귀', async () => {
    setOctokit(mockOctokit({ mergeableState: 'dirty', headRef: 'feature' }));
    setClaudeRunner(vi.fn().mockResolvedValue({ ok: true, text: 'done' }));
    const git = vi.fn((_cwd: string, args: ReadonlyArray<string>): Promise<GitResult> => {
      if (args.includes('merge') && args.includes('--no-edit') && !args.includes('--abort')) {
        return Promise.resolve(nonzero('CONFLICT'));
      }
      if (args.includes('--diff-filter=U')) return Promise.resolve(ok('src/x.ts\n'));
      // 공백 오류만 — git 실제 출력 형식. exit nonzero 지만 "leftover conflict marker" 없음.
      if (args.includes('--check')) {
        return Promise.resolve({
          code: 2,
          stdout: 'src/x.ts:2: trailing whitespace.\n+b \n',
          stderr: '',
        });
      }
      return Promise.resolve(ok());
    });
    setGitRunner(git);

    const r = await attemptConflictResolution(setup({}));
    expect(r).toEqual({ kind: 'resolved' });
    const pushed = git.mock.calls.some((c) => c[1].includes('push') && c[1].includes('feature'));
    expect(pushed).toBe(true);
    // 잘못된 abort 없음.
    const aborted = git.mock.calls.some((c) => c[1].includes('merge') && c[1].includes('--abort'));
    expect(aborted).toBe(false);
  });
});
