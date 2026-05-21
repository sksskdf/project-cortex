import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';
import { env } from './env';

// GitHub App 모드 — installation 별로 short-lived 토큰을 발급받아 Octokit 생성.
// 토큰은 약 1시간 유효 → 만료 전 갱신 위해 캐시에 expiresAt 동봉.
// 테스트 주입은 setOctokit(instance) — installation 무관하게 단일 mock 반환.

let _testOctokit: Octokit | null = null;

export function setOctokit(instance: Octokit | null) {
  _testOctokit = instance;
}

type CachedOctokit = { client: Octokit; expiresAt: number };
const _cache = new Map<number, CachedOctokit>();
// 만료 5분 전에 갱신 — 사용 중 만료 회피.
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

export async function getOctokitForInstallation(installationId: number): Promise<Octokit> {
  if (_testOctokit) return _testOctokit;

  const cached = _cache.get(installationId);
  if (cached && cached.expiresAt - TOKEN_REFRESH_BUFFER_MS > Date.now()) {
    return cached.client;
  }

  const auth = createAppAuth({
    appId: env.githubAppId(),
    privateKey: env.githubAppPrivateKey(),
  });
  const { token, expiresAt } = await auth({ type: 'installation', installationId });
  const client = new Octokit({ auth: token });
  _cache.set(installationId, {
    client,
    expiresAt: new Date(expiresAt).getTime(),
  });
  return client;
}

export type RepoRef = { owner: string; repo: string };

export type GitHubPRDetails = {
  number: number;
  title: string;
  headSha: string;
  state: 'open' | 'closed';
  merged: boolean;
  authorLogin: string;
  authorKind: 'agent' | 'human';
  linesAdded: number;
  linesRemoved: number;
  filesChanged: number;
  createdAt: Date;
  updatedAt: Date;
};

// 에이전트 계정 식별 — Phase 4에서 정교화. 현재는 휴리스틱.
const KNOWN_AGENT_LOGINS = new Set(['devin-ai-integration', 'devin', 'codex-bot']);

// Claude Code (claude.ai/code) 가 만든 PR 의 description footer 식별자.
// 사용자 본인 계정으로 push 했어도 body 에 이 marker 가 있으면 'agent' 로 분류.
// 사용자가 의도적으로 footer 를 지우면 'human' 으로 폴백 — 안전한 디폴트.
const CLAUDE_CODE_MARKER = /https:\/\/claude\.ai\/code\//i;

export function classifyAuthor(
  login: string,
  type: string | undefined,
  body?: string | null,
): 'agent' | 'human' {
  if (type?.toLowerCase() === 'bot') return 'agent';
  if (KNOWN_AGENT_LOGINS.has(login.toLowerCase())) return 'agent';
  if (body && CLAUDE_CODE_MARKER.test(body)) return 'agent';
  return 'human';
}

export async function getPRDetails(
  installationId: number,
  ref: RepoRef,
  number: number,
): Promise<GitHubPRDetails> {
  const octokit = await getOctokitForInstallation(installationId);
  const { data } = await octokit.pulls.get({
    owner: ref.owner,
    repo: ref.repo,
    pull_number: number,
  });

  return {
    number: data.number,
    title: data.title,
    headSha: data.head.sha,
    state: data.state as 'open' | 'closed',
    merged: data.merged,
    authorLogin: data.user?.login ?? 'unknown',
    authorKind: classifyAuthor(data.user?.login ?? '', data.user?.type, data.body),
    linesAdded: data.additions ?? 0,
    linesRemoved: data.deletions ?? 0,
    filesChanged: data.changed_files ?? 0,
    createdAt: new Date(data.created_at),
    updatedAt: new Date(data.updated_at),
  };
}

// Unified diff 텍스트(`a/... b/...` 형식) — Anthropic 분석 입력.
// Octokit 이 media type 을 받으면 data 를 string 으로 반환 (typing 은 unknown).
export async function getPRDiff(
  installationId: number,
  ref: RepoRef,
  number: number,
): Promise<string> {
  const octokit = await getOctokitForInstallation(installationId);
  const res = await octokit.pulls.get({
    owner: ref.owner,
    repo: ref.repo,
    pull_number: number,
    mediaType: { format: 'diff' },
  });
  return res.data as unknown as string;
}

export async function mergePR(
  installationId: number,
  ref: RepoRef,
  number: number,
  options?: { commitTitle?: string; method?: 'squash' | 'merge' | 'rebase' },
): Promise<{ merged: boolean; sha: string }> {
  const octokit = await getOctokitForInstallation(installationId);
  const { data } = await octokit.pulls.merge({
    owner: ref.owner,
    repo: ref.repo,
    pull_number: number,
    commit_title: options?.commitTitle,
    merge_method: options?.method ?? 'squash',
  });
  return { merged: data.merged, sha: data.sha };
}

// 머지된 PR 의 head 브랜치를 삭제. octokit.pulls.get 으로 head.ref 조회 후 git.deleteRef.
// fork / cross-repo PR 은 base 레포에 브랜치가 없어 skip — head.repo.full_name 비교로 판단.
export type DeleteBranchResult =
  | { kind: 'deleted'; ref: string }
  | { kind: 'skipped'; reason: 'fork-or-cross-repo' };

export async function deletePRHeadBranch(
  installationId: number,
  ref: RepoRef,
  number: number,
): Promise<DeleteBranchResult> {
  const octokit = await getOctokitForInstallation(installationId);
  const { data } = await octokit.pulls.get({
    owner: ref.owner,
    repo: ref.repo,
    pull_number: number,
  });
  const headFullName = data.head.repo?.full_name;
  if (headFullName !== `${ref.owner}/${ref.repo}`) {
    return { kind: 'skipped', reason: 'fork-or-cross-repo' };
  }
  await octokit.git.deleteRef({
    owner: ref.owner,
    repo: ref.repo,
    ref: `heads/${data.head.ref}`,
  });
  return { kind: 'deleted', ref: data.head.ref };
}

// PR 에 'Request Changes' 리뷰 제출 — 사용자가 PR 상세에서 '변경 요청' 누른 흐름.
// GitHub 의 REQUEST_CHANGES review 는 PR 을 차단(블록) 상태로 만들어 다른 리뷰어가 dismiss
// 하거나 작성자가 push 로 갱신할 때까지 머지를 막는다.
export async function requestChangesReview(
  installationId: number,
  ref: RepoRef,
  number: number,
  body: string,
): Promise<{ id: number; submittedAt: string | null }> {
  const octokit = await getOctokitForInstallation(installationId);
  const { data } = await octokit.pulls.createReview({
    owner: ref.owner,
    repo: ref.repo,
    pull_number: number,
    event: 'REQUEST_CHANGES',
    body,
  });
  return { id: data.id, submittedAt: data.submitted_at ?? null };
}

// PR 의 mergeable_state — GitHub 가 계산해 둔 머지 가능 여부.
// - 'clean'    : 머지 가능 (CI 통과, 충돌 없음, 리뷰 차단 없음)
// - 'dirty'    : base 와 충돌 발생
// - 'blocked'  : 보호 규칙·필수 리뷰·REQUEST_CHANGES 등으로 머지 차단
// - 'unstable' : CI 실패/진행 중. 머지 자체는 가능하지만 위험
// - 'behind'   : base 가 앞서 있음. 머지는 가능 (squash 면 무관)
// - 'unknown'  : GitHub 가 아직 계산 중 — 잠시 후 다시 시도 권장
// 그 외(`has_hooks` 등) 는 'unknown' 으로 폴백.
export type MergeableState = 'clean' | 'dirty' | 'blocked' | 'unstable' | 'behind' | 'unknown';

function normalizeMergeableState(raw: string | null | undefined): MergeableState {
  switch (raw) {
    case 'clean':
    case 'dirty':
    case 'blocked':
    case 'unstable':
    case 'behind':
    case 'unknown':
      return raw;
    default:
      return 'unknown';
  }
}

export async function getPRMergeableState(
  installationId: number,
  ref: RepoRef,
  number: number,
): Promise<MergeableState> {
  const octokit = await getOctokitForInstallation(installationId);
  const { data } = await octokit.pulls.get({
    owner: ref.owner,
    repo: ref.repo,
    pull_number: number,
  });
  return normalizeMergeableState(data.mergeable_state);
}
