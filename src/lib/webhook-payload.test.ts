import { describe, expect, it } from 'vitest';
import {
  mapCheckEvent,
  mapPullRequestEvent,
  mapReviewEvent,
  type GithubCheckEventPartial,
  type GithubPullRequestEventPartial,
  type GithubReviewEventPartial,
} from './webhook-payload';

function reviewEvent(overrides: Partial<GithubReviewEventPartial> = {}): GithubReviewEventPartial {
  return {
    action: 'submitted',
    review: { state: 'changes_requested', body: '버튼 색을 바꿔주세요', user: { login: 'owner' } },
    pull_request: { number: 42 },
    repository: { name: 'web', full_name: 'acme/web' },
    installation: { id: 99 },
    ...overrides,
  };
}

describe('mapReviewEvent', () => {
  it('changes_requested 리뷰를 매핑한다', () => {
    expect(mapReviewEvent(reviewEvent())).toEqual({
      repoSlug: 'acme/web',
      installationId: 99,
      prNumber: 42,
      reviewer: 'owner',
      body: '버튼 색을 바꿔주세요',
    });
  });

  it('submitted 가 아니면 null', () => {
    expect(mapReviewEvent(reviewEvent({ action: 'dismissed' }))).toBeNull();
  });

  it('approved/commented state 는 null', () => {
    expect(
      mapReviewEvent(
        reviewEvent({ review: { state: 'approved', body: '', user: { login: 'o' } } }),
      ),
    ).toBeNull();
    expect(
      mapReviewEvent(
        reviewEvent({ review: { state: 'commented', body: 'x', user: { login: 'o' } } }),
      ),
    ).toBeNull();
  });

  it('PR 번호가 없으면 null', () => {
    expect(mapReviewEvent(reviewEvent({ pull_request: undefined }))).toBeNull();
  });

  it('body/installation/reviewer 누락은 안전 기본값', () => {
    const r = mapReviewEvent(
      reviewEvent({ review: { state: 'changes_requested' }, installation: undefined }),
    );
    expect(r).toEqual({
      repoSlug: 'acme/web',
      installationId: null,
      prNumber: 42,
      reviewer: 'unknown',
      body: '',
    });
  });
});

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
        authorAssociation: null,
        createdAt: new Date('2026-05-01T00:00:00Z'),
        updatedAt: new Date('2026-05-02T00:00:00Z'),
      },
    });
  });

  it('author_association 을 payload 로 전달 (권한 게이트용)', () => {
    const ev = baseEvent();
    ev.pull_request.author_association = 'NONE';
    expect(mapPullRequestEvent(ev)?.pr.authorAssociation).toBe('NONE');
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

function baseCheckEvent(overrides: Partial<GithubCheckEventPartial> = {}): GithubCheckEventPartial {
  return {
    action: 'completed',
    check_run: { head_sha: 'sha-xyz' },
    repository: { name: 'cortex-web', full_name: 'acme/cortex-web' },
    installation: { id: 999 },
    ...overrides,
  };
}

describe('mapCheckEvent', () => {
  it('maps completed check_run to payload', () => {
    const result = mapCheckEvent(baseCheckEvent());
    expect(result).toEqual({
      repoSlug: 'acme/cortex-web',
      installationId: 999,
      headSha: 'sha-xyz',
    });
  });

  it('maps completed check_suite (no check_run block) via check_suite.head_sha', () => {
    const result = mapCheckEvent(
      baseCheckEvent({ check_run: undefined, check_suite: { head_sha: 'sha-suite' } }),
    );
    expect(result?.headSha).toBe('sha-suite');
  });

  it('returns null for non-completed action (queued/in_progress)', () => {
    expect(mapCheckEvent(baseCheckEvent({ action: 'in_progress' }))).toBeNull();
    expect(mapCheckEvent(baseCheckEvent({ action: 'queued' }))).toBeNull();
  });

  it('returns null when neither check_run nor check_suite has head_sha', () => {
    expect(mapCheckEvent(baseCheckEvent({ check_run: undefined }))).toBeNull();
  });

  it('returns installationId=null when no installation block', () => {
    expect(mapCheckEvent(baseCheckEvent({ installation: undefined }))?.installationId).toBeNull();
  });
});
