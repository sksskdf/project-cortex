import { Octokit } from '@octokit/rest';
import { env } from './env';

// Octokit 인스턴스는 lazy + 메모이즈. 테스트에서 setOctokit으로 주입 가능.
let _octokit: Octokit | null = null;

export function setOctokit(instance: Octokit | null) {
  _octokit = instance;
}

export function getOctokit(): Octokit {
  if (_octokit) return _octokit;
  _octokit = new Octokit({ auth: env.githubToken() });
  return _octokit;
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

function classifyAuthor(login: string, type: string | undefined): 'agent' | 'human' {
  if (type?.toLowerCase() === 'bot') return 'agent';
  if (KNOWN_AGENT_LOGINS.has(login.toLowerCase())) return 'agent';
  return 'human';
}

export async function getPRDetails(ref: RepoRef, number: number): Promise<GitHubPRDetails> {
  const { data } = await getOctokit().pulls.get({
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

export async function mergePR(
  ref: RepoRef,
  number: number,
  options?: { commitTitle?: string; method?: 'squash' | 'merge' | 'rebase' },
): Promise<{ merged: boolean; sha: string }> {
  const { data } = await getOctokit().pulls.merge({
    owner: ref.owner,
    repo: ref.repo,
    pull_number: number,
    commit_title: options?.commitTitle,
    merge_method: options?.method ?? 'squash',
  });
  return { merged: data.merged, sha: data.sha };
}
