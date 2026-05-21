import type { Octokit } from '@octokit/rest';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { getPRDetails, mergePR, setOctokit } from './github';

type PullsMock = { get?: Mock; merge?: Mock };

function makeMockOctokit(pulls: PullsMock = {}): Octokit {
  return {
    pulls: { get: vi.fn(), merge: vi.fn(), ...pulls },
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
