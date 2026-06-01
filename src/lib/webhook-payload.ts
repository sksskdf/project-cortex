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
    body: string | null;
    head: { sha: string };
    additions: number;
    deletions: number;
    changed_files: number;
    merged: boolean;
    user: { login: string; type?: string } | null;
    // GitHub 이 계산하는 작성자-레포 관계 (OWNER/MEMBER/COLLABORATOR/CONTRIBUTOR/NONE 등).
    // 위조 불가 — 자동 머지 권한 게이트(외부 기여자 차단)에 사용.
    author_association?: string;
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
  // GitHub App 이벤트에 항상 동봉. PAT/legacy webhook 은 없을 수 있어 optional.
  installation?: {
    id: number;
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
    installationId: event.installation?.id ?? null,
    pr: {
      number: event.pull_request.number,
      title: event.pull_request.title,
      body: event.pull_request.body,
      headSha: event.pull_request.head.sha,
      additions: event.pull_request.additions,
      deletions: event.pull_request.deletions,
      filesChanged: event.pull_request.changed_files,
      merged: event.pull_request.merged,
      authorLogin: login,
      authorKind: classifyAuthor(login, event.pull_request.user?.type, event.pull_request.body),
      authorAssociation: event.pull_request.author_association ?? null,
      createdAt: new Date(event.pull_request.created_at),
      updatedAt: new Date(event.pull_request.updated_at),
    },
  };
}

// GitHub check_run / check_suite 이벤트 — 둘 다 head_sha 가 있으면 같은 처리.
// 'completed' action 만 의미 있음 (queued/in_progress 는 결과 미확정).
// check_suite 는 여러 run 을 묶지만 우리는 매번 listCheckRunsForRef 로 재집계하므로
// suite vs run 구분 없음 — 둘 다 같은 mapper.
export type GithubCheckEventPartial = {
  action: string;
  check_run?: { head_sha: string };
  check_suite?: { head_sha: string };
  repository: {
    name: string;
    full_name: string;
  };
  installation?: { id: number };
};

export type WebhookCheckPayload = {
  repoSlug: string;
  installationId: number | null;
  headSha: string;
};

export function mapCheckEvent(event: GithubCheckEventPartial): WebhookCheckPayload | null {
  if (event.action !== 'completed') return null;
  const headSha = event.check_run?.head_sha ?? event.check_suite?.head_sha;
  if (!headSha) return null;
  return {
    repoSlug: event.repository.full_name,
    installationId: event.installation?.id ?? null,
    headSha,
  };
}

// Phase 13.1 — pull_request_review 이벤트. submitted + state=changes_requested 만 의미 있음
// (approved/commented/dismissed 는 무시). review.body 가 변경 요청 본문.
export type GithubReviewEventPartial = {
  action: string;
  review?: {
    state?: string;
    body?: string | null;
    user?: { login: string } | null;
  };
  pull_request?: { number: number };
  repository: { name: string; full_name: string };
  installation?: { id: number };
};

export type WebhookReviewPayload = {
  repoSlug: string;
  installationId: number | null;
  prNumber: number;
  reviewer: string;
  body: string;
};

export function mapReviewEvent(event: GithubReviewEventPartial): WebhookReviewPayload | null {
  if (event.action !== 'submitted') return null;
  // GitHub 은 state 를 소문자로 보냄 (changes_requested / approved / commented).
  if (event.review?.state?.toLowerCase() !== 'changes_requested') return null;
  const prNumber = event.pull_request?.number;
  if (!prNumber) return null;
  return {
    repoSlug: event.repository.full_name,
    installationId: event.installation?.id ?? null,
    prNumber,
    reviewer: event.review?.user?.login ?? 'unknown',
    body: event.review?.body ?? '',
  };
}
