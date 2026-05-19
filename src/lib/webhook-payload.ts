import { classifyAuthor } from './github';
import type { WebhookPRAction, WebhookPRPayload } from './sync';

// 처리 대상 액션. 그 외는 null 리턴(no-op).
const HANDLED_ACTIONS: ReadonlyArray<WebhookPRAction> = [
  'opened',
  'closed',
  'reopened',
  'synchronize',
  'edited',
];

// GitHub pull_request 이벤트 페이로드 부분 형태. 전체 union은 @octokit/webhooks-types
// 의 PullRequestEvent에 있지만, 우리가 읽는 필드만 명시.
export type GithubPullRequestEventPartial = {
  action: string;
  pull_request: {
    number: number;
    title: string;
    head: { sha: string };
    additions: number;
    deletions: number;
    changed_files: number;
    merged: boolean;
    user: { login: string; type?: string } | null;
    created_at: string;
    updated_at: string;
  };
  repository: {
    // GitHub 은 두 가지를 보냄:
    // - name: 'project-cortex' (레포 짧은 이름)
    // - full_name: 'sksskdf/project-cortex' (owner/repo)
    // lib/pre-review·auto-merge 가 slug.split('/') 로 owner 를 뽑으므로 full_name 사용.
    name: string;
    full_name: string;
  };
};

export function mapPullRequestEvent(event: GithubPullRequestEventPartial): WebhookPRPayload | null {
  if (!HANDLED_ACTIONS.includes(event.action as WebhookPRAction)) {
    return null;
  }

  const login = event.pull_request.user?.login ?? 'unknown';

  return {
    action: event.action as WebhookPRAction,
    repoSlug: event.repository.full_name,
    pr: {
      number: event.pull_request.number,
      title: event.pull_request.title,
      headSha: event.pull_request.head.sha,
      additions: event.pull_request.additions,
      deletions: event.pull_request.deletions,
      filesChanged: event.pull_request.changed_files,
      merged: event.pull_request.merged,
      authorLogin: login,
      authorKind: classifyAuthor(login, event.pull_request.user?.type),
      createdAt: new Date(event.pull_request.created_at),
      updatedAt: new Date(event.pull_request.updated_at),
    },
  };
}
