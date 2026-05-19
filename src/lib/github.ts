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

export function classifyAuthor(login: string, type: string | undefined): 'agent' | 'human' {
  if (type?.toLowerCase() === 'bot') return 'agent';
  if (KNOWN_AGENT_LOGINS.has(login.toLowerCase())) return 'agent';
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
    authorKind: classifyAuthor(data.user?.login ?? '', data.user?.type),
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
