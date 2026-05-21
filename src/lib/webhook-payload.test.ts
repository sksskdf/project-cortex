import { describe, expect, it } from 'vitest';
import { mapPullRequestEvent, type GithubPullRequestEventPartial } from './webhook-payload';

function baseEvent(
  overrides: Partial<GithubPullRequestEventPartial> = {},
): GithubPullRequestEventPartial {
  return {
    action: 'opened',
    pull_request: {
      number: 42,
      title: 'Add feature',
      body: null,
      head: { sha: 'abc123' },
      additions: 10,
      deletions: 2,
      changed_files: 3,
      merged: false,
      user: { login: 'alice', type: 'User' },
      created_at: '2026-05-01T00:00:00Z',
      updated_at: '2026-05-02T00:00:00Z',
    },
    repository: { name: 'cortex-web', full_name: 'acme/cortex-web' },
    installation: { id: 555 },
    ...overrides,
  };
}

describe('mapPullRequestEvent', () => {
  it('maps opened action to WebhookPRPayload with owner/repo slug', () => {
    const result = mapPullRequestEvent(baseEvent());
    expect(result).toEqual({
      action: 'opened',
      repoSlug: 'acme/cortex-web',
      installationId: 555,
      pr: {
        number: 42,
        title: 'Add feature',
        body: null,
        headSha: 'abc123',
        additions: 10,
        deletions: 2,
        filesChanged: 3,
        merged: false,
        authorLogin: 'alice',
        authorKind: 'human',
        createdAt: new Date('2026-05-01T00:00:00Z'),
        updatedAt: new Date('2026-05-02T00:00:00Z'),
      },
    });
  });

  it('classifies Bot user.type as agent', () => {
    const result = mapPullRequestEvent(
      baseEvent({
        pull_request: {
          ...baseEvent().pull_request,
          user: { login: 'dependabot', type: 'Bot' },
        },
      }),
    );
    expect(result?.pr.authorKind).toBe('agent');
  });

  it('classifies known agent login as agent even with type=User', () => {
    const result = mapPullRequestEvent(
      baseEvent({
        pull_request: {
          ...baseEvent().pull_request,
          user: { login: 'devin', type: 'User' },
        },
      }),
    );
    expect(result?.pr.authorKind).toBe('agent');
  });

  it('returns null for unhandled action', () => {
    expect(mapPullRequestEvent(baseEvent({ action: 'assigned' }))).toBeNull();
    expect(mapPullRequestEvent(baseEvent({ action: 'labeled' }))).toBeNull();
    expect(mapPullRequestEvent(baseEvent({ action: 'review_requested' }))).toBeNull();
  });

  it('maps all 5 handled actions', () => {
    for (const action of ['opened', 'closed', 'reopened', 'synchronize', 'edited'] as const) {
      const result = mapPullRequestEvent(baseEvent({ action }));
      expect(result?.action).toBe(action);
    }
  });

  it('returns installationId=null when webhook has no installation block (legacy PAT)', () => {
    const result = mapPullRequestEvent(baseEvent({ installation: undefined }));
    expect(result?.installationId).toBeNull();
  });

  it('uses fallback login when user is null', () => {
    const result = mapPullRequestEvent(
      baseEvent({
        pull_request: { ...baseEvent().pull_request, user: null },
      }),
    );
    expect(result?.pr.authorLogin).toBe('unknown');
    expect(result?.pr.authorKind).toBe('human');
  });

  it('classifies as agent when body has claude.ai/code marker even with human user', () => {
    const result = mapPullRequestEvent(
      baseEvent({
        pull_request: {
          ...baseEvent().pull_request,
          body: '본문\n\nhttps://claude.ai/code/session_017abc',
          user: { login: 'sksskdf', type: 'User' },
        },
      }),
    );
    expect(result?.pr.authorKind).toBe('agent');
  });
});
