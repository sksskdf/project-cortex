import type { Octokit } from '@octokit/rest';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  getPRDetails,
  listCheckRunsForRef,
  listOpenPullRequests,
  mergePR,
  setOctokit,
} from './github';

type PullsMock = { get?: Mock; merge?: Mock };
type ChecksMock = { listForRef?: Mock };

function makeMockOctokit(pulls: PullsMock = {}, checks: ChecksMock = {}): Octokit {
  return {
    pulls: { get: vi.fn(), merge: vi.fn(), ...pulls },
    checks: { listForRef: vi.fn(), ...checks },
  } as unknown as Octokit;
}

afterEach(() => {
  setOctokit(null);
});

describe('getPRDetails', () => {
  it('maps GitHub API response to GitHubPRDetails shape', async () => {
    const mock = makeMockOctokit({
      get: vi.fn().mockResolvedValue({
        data: {
          number: 42,
          title: 'Test PR',
          head: { sha: 'abc123' },
          state: 'open',
          merged: false,
          user: { login: 'someone', type: 'User' },
          additions: 50,
          deletions: 10,
          changed_files: 3,
          created_at: '2026-05-01T00:00:00Z',
          updated_at: '2026-05-02T00:00:00Z',
        },
      }),
    });
    setOctokit(mock);

    const result = await getPRDetails(1, { owner: 'cortex', repo: 'web' }, 42);

    expect(result).toEqual({
      number: 42,
      title: 'Test PR',
      headSha: 'abc123',
      state: 'open',
      merged: false,
      authorLogin: 'someone',
      authorKind: 'human',
      linesAdded: 50,
      linesRemoved: 10,
      filesChanged: 3,
      createdAt: new Date('2026-05-01T00:00:00Z'),
      updatedAt: new Date('2026-05-02T00:00:00Z'),
    });
  });

  it('classifies Bot type as agent', async () => {
    setOctokit(
      makeMockOctokit({
        get: vi.fn().mockResolvedValue({
          data: {
            number: 1,
            title: '',
            head: { sha: 's' },
            state: 'open',
            merged: false,
            user: { login: 'some-bot', type: 'Bot' },
            additions: 0,
            deletions: 0,
            changed_files: 0,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        }),
      }),
    );

    const result = await getPRDetails(1, { owner: 'x', repo: 'y' }, 1);
    expect(result.authorKind).toBe('agent');
  });

  it('classifies known agent logins as agent even if type=User', async () => {
    setOctokit(
      makeMockOctokit({
        get: vi.fn().mockResolvedValue({
          data: {
            number: 1,
            title: '',
            head: { sha: 's' },
            state: 'open',
            merged: false,
            user: { login: 'devin', type: 'User' },
            additions: 0,
            deletions: 0,
            changed_files: 0,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        }),
      }),
    );

    const result = await getPRDetails(1, { owner: 'x', repo: 'y' }, 1);
    expect(result.authorKind).toBe('agent');
  });

  // claude.ai/code marker — 사용자 본인 계정으로 push 했어도 Claude Code 가
  // 생성한 PR 이면 agent 로 분류해 자동 머지 후보에 포함.
  it('classifies as agent when PR body contains claude.ai/code marker', async () => {
    setOctokit(
      makeMockOctokit({
        get: vi.fn().mockResolvedValue({
          data: {
            number: 1,
            title: '',
            body: '## 변경 요약\n\n어쩌고\n\n---\nhttps://claude.ai/code/session_017xyz\n',
            head: { sha: 's' },
            state: 'open',
            merged: false,
            user: { login: 'sksskdf', type: 'User' },
            additions: 0,
            deletions: 0,
            changed_files: 0,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        }),
      }),
    );
    const result = await getPRDetails(1, { owner: 'x', repo: 'y' }, 1);
    expect(result.authorKind).toBe('agent');
  });

  it('stays human when body lacks the marker', async () => {
    setOctokit(
      makeMockOctokit({
        get: vi.fn().mockResolvedValue({
          data: {
            number: 1,
            title: '',
            body: '평범한 사람 PR 설명',
            head: { sha: 's' },
            state: 'open',
            merged: false,
            user: { login: 'sksskdf', type: 'User' },
            additions: 0,
            deletions: 0,
            changed_files: 0,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        }),
      }),
    );
    const result = await getPRDetails(1, { owner: 'x', repo: 'y' }, 1);
    expect(result.authorKind).toBe('human');
  });
});

describe('listCheckRunsForRef', () => {
  function withRuns(runs: Array<{ status: string; conclusion: string | null }>) {
    setOctokit(
      makeMockOctokit(
        {},
        {
          listForRef: vi.fn().mockResolvedValue({ data: { check_runs: runs } }),
        },
      ),
    );
  }

  it('returns pending when no check runs exist', async () => {
    withRuns([]);
    const result = await listCheckRunsForRef(1, { owner: 'a', repo: 'b' }, 'sha');
    expect(result).toEqual({ status: 'pending', total: 0, successCount: 0, failureCount: 0 });
  });

  it('returns passed when all completed are success', async () => {
    withRuns([
      { status: 'completed', conclusion: 'success' },
      { status: 'completed', conclusion: 'success' },
    ]);
    const result = await listCheckRunsForRef(1, { owner: 'a', repo: 'b' }, 'sha');
    expect(result.status).toBe('passed');
    expect(result.successCount).toBe(2);
  });

  it('returns failed when any conclusion is failure/cancelled/timed_out/action_required', async () => {
    withRuns([
      { status: 'completed', conclusion: 'success' },
      { status: 'completed', conclusion: 'failure' },
    ]);
    const result = await listCheckRunsForRef(1, { owner: 'a', repo: 'b' }, 'sha');
    expect(result.status).toBe('failed');
    expect(result.failureCount).toBe(1);
  });

  it('returns pending when at least one is still running and no failures', async () => {
    withRuns([
      { status: 'completed', conclusion: 'success' },
      { status: 'in_progress', conclusion: null },
    ]);
    const result = await listCheckRunsForRef(1, { owner: 'a', repo: 'b' }, 'sha');
    expect(result.status).toBe('pending');
  });

  it('treats neutral/skipped as non-counting (passed if others success)', async () => {
    withRuns([
      { status: 'completed', conclusion: 'neutral' },
      { status: 'completed', conclusion: 'skipped' },
      { status: 'completed', conclusion: 'success' },
    ]);
    const result = await listCheckRunsForRef(1, { owner: 'a', repo: 'b' }, 'sha');
    expect(result.status).toBe('passed');
    expect(result.successCount).toBe(1);
  });
});

describe('mergePR', () => {
  it('defaults to squash merge method', async () => {
    const mergeSpy = vi.fn().mockResolvedValue({ data: { merged: true, sha: 'merged-sha' } });
    setOctokit(makeMockOctokit({ merge: mergeSpy }));

    const result = await mergePR(1, { owner: 'cortex', repo: 'web' }, 100);

    expect(mergeSpy).toHaveBeenCalledWith({
      owner: 'cortex',
      repo: 'web',
      pull_number: 100,
      commit_title: undefined,
      merge_method: 'squash',
    });
    expect(result).toEqual({ merged: true, sha: 'merged-sha' });
  });

  it('respects explicit method option', async () => {
    const mergeSpy = vi.fn().mockResolvedValue({ data: { merged: true, sha: 'x' } });
    setOctokit(makeMockOctokit({ merge: mergeSpy }));

    await mergePR(1, { owner: 'a', repo: 'b' }, 1, { method: 'rebase', commitTitle: 'Hello' });

    expect(mergeSpy).toHaveBeenCalledWith({
      owner: 'a',
      repo: 'b',
      pull_number: 1,
      commit_title: 'Hello',
      merge_method: 'rebase',
    });
  });
});

describe('listOpenPullRequests', () => {
  const makePr = (n: number) => ({
    number: n,
    title: `pr ${n}`,
    body: null,
    head: { sha: `sha-${n}` },
    state: 'closed',
    merged_at: '2026-05-10T00:00:00Z',
    user: { login: 'devin', type: 'User' },
    created_at: '2026-05-18T00:00:00Z',
    updated_at: '2026-05-18T00:00:00Z',
  });

  it('100개 초과 PR 도 페이지네이션으로 모두 가져온다 (110 → 110)', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => makePr(i + 1));
    const page2 = Array.from({ length: 10 }, (_, i) => makePr(i + 101));
    const list = vi
      .fn()
      .mockResolvedValueOnce({ data: page1 })
      .mockResolvedValueOnce({ data: page2 });
    setOctokit({ pulls: { list }, checks: {} } as unknown as Octokit);

    const result = await listOpenPullRequests(123, { owner: 'acme', repo: 'web' });

    expect(result).toHaveLength(110);
    expect(list).toHaveBeenCalledTimes(2);
    expect(list.mock.calls[0][0].page).toBe(1);
    expect(list.mock.calls[1][0].page).toBe(2);
  });

  it('한 페이지(100건 미만)로 끝나면 추가 호출하지 않는다', async () => {
    const list = vi.fn().mockResolvedValue({ data: [makePr(1)] });
    setOctokit({ pulls: { list }, checks: {} } as unknown as Octokit);

    const result = await listOpenPullRequests(123, { owner: 'acme', repo: 'web' });

    expect(result).toHaveLength(1);
    expect(list).toHaveBeenCalledTimes(1);
  });
});
