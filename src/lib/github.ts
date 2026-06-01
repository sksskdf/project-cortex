import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db/client';
import { projects } from '@/db/schema';
import { listAppCandidates, listAppConfigsForAuth } from './github-apps';

// GitHub App 모드 — installation 별로 short-lived 토큰을 발급받아 Octokit 생성.
// 토큰은 약 1시간 유효 → 만료 전 갱신 위해 캐시에 expiresAt 동봉.
// 다중 App: installation 은 App 별로 의미가 다르므로 어느 App 자격증명을 쓸지 결정해야 한다.
// 명시 appConfigId 가 없으면 그 installation 으로 등록된 프로젝트의 appConfigId 로 해석하고,
// 그래도 없으면 env 단일 App 으로 폴백 (기존 동작 유지).
// 테스트 주입은 setOctokit(instance) — installation 무관하게 단일 mock 반환.

let _testOctokit: Octokit | null = null;

export function setOctokit(instance: Octokit | null) {
  _testOctokit = instance;
}

type CachedOctokit = { client: Octokit; expiresAt: number };
const _cache = new Map<string, CachedOctokit>();
// 만료 5분 전에 갱신 — 사용 중 만료 회피.
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

// installation 으로 등록된 프로젝트의 App 설정 id. 없으면 null.
function appConfigIdForInstallation(installationId: number): number | null {
  const row = db
    .select({ appConfigId: projects.appConfigId })
    .from(projects)
    .where(eq(projects.installationId, installationId))
    .get();
  return row?.appConfigId ?? null;
}

// 동작한 App 으로 이 installation 의 프로젝트들 appConfigId 를 백필 — 다음부턴 바로 해석되고
// 더 이상 후보를 헤매지 않는다. webhook onboard 로 appConfigId 가 비어 있던 프로젝트 자가 치유.
function backfillAppConfigId(installationId: number, appConfigId: number | null): void {
  if (appConfigId === null) return;
  try {
    db.update(projects)
      .set({ appConfigId })
      .where(and(eq(projects.installationId, installationId), isNull(projects.appConfigId)))
      .run();
  } catch {
    // 백필 실패는 치명적이지 않음 — 다음 호출에서 다시 시도.
  }
}

export async function getOctokitForInstallation(
  installationId: number,
  appConfigId?: number | null,
): Promise<Octokit> {
  if (_testOctokit) return _testOctokit;

  // installation 은 정확히 하나의 App 에 속하므로 installation 단위로 캐시.
  const cacheKey = `inst:${installationId}`;
  const cached = _cache.get(cacheKey);
  if (cached && cached.expiresAt - TOKEN_REFRESH_BUFFER_MS > Date.now()) {
    return cached.client;
  }

  // 명시 appConfigId(또는 프로젝트 매핑)를 우선하되, 등록된 모든 App(+env)을 후보로 순차 시도.
  // appConfigId 가 null/오설정이어도 그 installation 을 소유한 App 을 찾아낸다.
  const explicit =
    appConfigId === undefined ? appConfigIdForInstallation(installationId) : appConfigId;
  const candidates = listAppCandidates(explicit);
  if (candidates.length === 0) {
    throw new Error(
      'GitHub App 자격증명이 없습니다 — 설정에서 App 을 등록하거나 .env 를 설정하세요.',
    );
  }

  let lastErr: unknown = null;
  for (const cand of candidates) {
    try {
      const auth = createAppAuth({ appId: cand.appId, privateKey: cand.privateKey });
      const { token, expiresAt } = await auth({ type: 'installation', installationId });
      const client = new Octokit({ auth: token });
      _cache.set(cacheKey, { client, expiresAt: new Date(expiresAt).getTime() });
      backfillAppConfigId(installationId, cand.appConfigId);
      return client;
    } catch (err) {
      // 이 App 은 해당 installation 을 소유하지 않음(404) 등 → 다음 후보.
      lastErr = err;
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(
        `installation ${installationId} 에 대한 토큰을 발급할 수 있는 App 을 찾지 못했습니다.`,
      );
}

// Phase 8 — App 설치 리포 import. App-level JWT 로 모든 installation 을 나열하고, 각
// installation 토큰으로 접근 가능한 리포를 모은다. 사용자가 /projects 에서 골라 등록.
// 테스트 주입은 setOctokit — installation 무관 단일 mock(rest.apps 메서드 제공) 으로 양쪽 분기 흡수.
export type InstalledRepo = {
  slug: string;
  name: string;
  description: string | null;
  private: boolean;
  defaultBranch: string;
};
export type InstallationWithRepos = {
  installationId: number;
  account: string;
  accountType: 'Organization' | 'User';
  // 다중 App — 이 installation 이 속한 App 설정 id. null 이면 env 단일 App. 등록 시 projects 에 기록.
  appConfigId: number | null;
  // App 라벨 (UI 그룹 헤더용). env App 은 빈 문자열.
  appName: string;
  repos: InstalledRepo[];
};

// 등록된 모든 App 설정(+env 폴백)을 순회하며 각 App 의 installation·접근 가능 리포를 모은다.
// 테스트 주입(setOctokit)이 있으면 단일 mock 으로 한 App(appConfigId=null) 만 순회.
export async function listAppInstallationRepos(): Promise<InstallationWithRepos[]> {
  const results: InstallationWithRepos[] = [];

  if (_testOctokit) {
    await collectInstallations(_testOctokit, null, '', results);
    return results;
  }

  for (const config of listAppConfigsForAuth()) {
    const appOctokit = buildAppOctokitFor(config.appId, config.privateKey);
    await collectInstallations(appOctokit, config.appConfigId, config.name, results);
  }
  return results;
}

async function collectInstallations(
  appOctokit: Octokit,
  appConfigId: number | null,
  appName: string,
  out: InstallationWithRepos[],
): Promise<void> {
  const installations = await appOctokit.paginate(appOctokit.rest.apps.listInstallations, {
    per_page: 100,
  });
  for (const inst of installations) {
    const account = inst.account;
    const accountLogin = account && 'login' in account ? account.login : 'unknown';
    const accountType =
      account && 'type' in account && account.type === 'Organization' ? 'Organization' : 'User';

    const instOctokit = await getOctokitForInstallation(inst.id, appConfigId);
    // 페이지네이션 응답 형태가 wrapped({total_count, repositories}) — paginate 가 풀어준다.
    const repos = await instOctokit.paginate(
      instOctokit.rest.apps.listReposAccessibleToInstallation,
      { per_page: 100 },
    );
    out.push({
      installationId: inst.id,
      account: accountLogin,
      accountType,
      appConfigId,
      appName,
      repos: repos.map((r) => ({
        slug: r.full_name,
        name: r.name,
        description: r.description ?? null,
        private: r.private,
        defaultBranch: r.default_branch,
      })),
    });
  }
}

// app-level JWT 인증 Octokit — apps.listInstallations 호출용. authStrategy 가 App JWT 를
// 자동 생성하고 installation 엔드포인트는 토큰을 교환한다.
function buildAppOctokitFor(appId: string, privateKey: string): Octokit {
  return new Octokit({ authStrategy: createAppAuth, auth: { appId, privateKey } });
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
  options?: { commitTitle?: string; method?: 'squash' | 'merge' | 'rebase'; sha?: string },
): Promise<{ merged: boolean; sha: string }> {
  const octokit = await getOctokitForInstallation(installationId);
  const { data } = await octokit.pulls.merge({
    owner: ref.owner,
    repo: ref.repo,
    pull_number: number,
    commit_title: options?.commitTitle,
    merge_method: options?.method ?? 'squash',
    // SHA 지정 — PR head 가 그 사이 새 commit 으로 이동했으면 GitHub 가 405 로 거부.
    // 분석 안 된 새 commit 이 squash 에 포함돼 누락되는 race 방지 (Cortex 자체 사고로 확인됨).
    sha: options?.sha,
  });
  return { merged: data.merged, sha: data.sha };
}

// PR 의 머지 가능 상태 + head/base 브랜치 ref. Phase 13.2 충돌 자동 해결의 입력.
// mergeableState: 'dirty' = base 와 충돌. 'clean'/'unstable'/'behind'/'blocked'/'unknown' 등.
// GitHub 가 mergeable 을 비동기로 계산하므로 push 직후엔 'unknown'/null 일 수 있음.
// headRepoFullName 으로 fork/cross-repo 판별 (로컬 워크스페이스가 base 레포 클론이라
// fork PR 브랜치는 직접 push 불가 → 자동 해결 비대상).
export type PRMergeStatus = {
  mergeableState: string;
  mergeable: boolean | null;
  headRef: string;
  baseRef: string;
  headRepoFullName: string | undefined;
};

export async function getPRMergeStatus(
  installationId: number,
  ref: RepoRef,
  number: number,
): Promise<PRMergeStatus> {
  const octokit = await getOctokitForInstallation(installationId);
  const { data } = await octokit.pulls.get({
    owner: ref.owner,
    repo: ref.repo,
    pull_number: number,
  });
  return {
    mergeableState: data.mergeable_state,
    mergeable: data.mergeable,
    headRef: data.head.ref,
    baseRef: data.base.ref,
    headRepoFullName: data.head.repo?.full_name,
  };
}

// PR(=issue) 에 일반 코멘트 작성. 충돌 자동 해결 실패 시 사람에게 사유 회신용.
export async function addPRComment(
  installationId: number,
  ref: RepoRef,
  number: number,
  body: string,
): Promise<{ id: number }> {
  const octokit = await getOctokitForInstallation(installationId);
  const { data } = await octokit.issues.createComment({
    owner: ref.owner,
    repo: ref.repo,
    issue_number: number,
    body,
  });
  return { id: data.id };
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

// PR head SHA 의 모든 Check Run 결과 집계. GitHub Actions, 외부 CI (CircleCI 등) 가
// 모두 check_run 으로 들어옴. 결론은 3분기:
//   - 'passed'   : 1개 이상 conclusion='success', failure/cancelled 없음.
//   - 'failed'   : 1개 이상 failure/cancelled/timed_out/action_required.
//   - 'pending'  : 아직 결과가 안 나옴 (queued/in_progress) — 또는 check run 자체가
//                  하나도 없음 (CI 미설정 레포 — testsPassed 는 계속 null 유지).
// neutral/skipped 는 결과 영향 없음 (성공도 실패도 아님).
export type CheckRunsSummary = {
  status: 'passed' | 'failed' | 'pending';
  total: number;
  successCount: number;
  failureCount: number;
};

export async function listCheckRunsForRef(
  installationId: number,
  ref: RepoRef,
  sha: string,
): Promise<CheckRunsSummary> {
  const octokit = await getOctokitForInstallation(installationId);
  const { data } = await octokit.checks.listForRef({
    owner: ref.owner,
    repo: ref.repo,
    ref: sha,
    per_page: 100,
  });

  const runs = data.check_runs ?? [];
  if (runs.length === 0) {
    return { status: 'pending', total: 0, successCount: 0, failureCount: 0 };
  }

  let successCount = 0;
  let failureCount = 0;
  let stillRunning = false;

  for (const run of runs) {
    if (run.status !== 'completed') {
      stillRunning = true;
      continue;
    }
    switch (run.conclusion) {
      case 'success':
        successCount += 1;
        break;
      case 'failure':
      case 'cancelled':
      case 'timed_out':
      case 'action_required':
        failureCount += 1;
        break;
      // neutral / skipped — 영향 없음.
      default:
        break;
    }
  }

  let status: CheckRunsSummary['status'];
  if (failureCount > 0) status = 'failed';
  else if (stillRunning) status = 'pending';
  else if (successCount > 0) status = 'passed';
  else status = 'pending'; // 전부 neutral/skipped — 판단 불가.

  return { status, total: runs.length, successCount, failureCount };
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

// 등록된 레포의 open PR 목록 — reconcile 흐름에서 다운타임 중 놓친 PR 복구용.
// state='open' 만 가져옴 (closed/merged 는 webhook 으로 받았어야 함, 복구 의미 적음).
export type PRListItem = {
  number: number;
  title: string;
  body: string | null;
  headSha: string;
  state: 'open' | 'closed';
  merged: boolean;
  authorLogin: string;
  authorType: string | undefined;
  authorBody: string | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  createdAt: Date;
  updatedAt: Date;
};

// Phase 8 reconcile — 다운타임 회복 + GitHub 에서 직접 머지/닫은 PR 의 status 갱신.
// state='all' + sort='updated' desc — 최근 갱신된 PR 부터 1 페이지만 (오래된 closed PR
// 들이 폭주하지 않게). 100건 한도면 단일 사용자 시나리오에 충분.
//
// 함수명은 기존 호출처 호환을 위해 listOpenPullRequests 유지. 의미는 "최근 갱신 PR 리스트"
// 로 확장됨 — open 뿐 아니라 closed/merged 포함.
export async function listOpenPullRequests(
  installationId: number,
  ref: RepoRef,
): Promise<PRListItem[]> {
  const octokit = await getOctokitForInstallation(installationId);
  // 페이지네이션 — pulls.list 는 페이지당 최대 100건. 페이지네이션이 없으면 PR 이 100개를
  // 넘는 레포에서 잘려 Cortex PR 수가 실제보다 적게 나온다 (110 → 100). 한 페이지가
  // per_page 미만이면 마지막 페이지 — 종료. MAX_PAGES 는 폭주 방지 안전 상한.
  const PER_PAGE = 100;
  const MAX_PAGES = 50;
  const items: PRListItem[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const { data } = await octokit.pulls.list({
      owner: ref.owner,
      repo: ref.repo,
      state: 'all',
      sort: 'updated',
      direction: 'desc',
      per_page: PER_PAGE,
      page,
    });
    for (const pr of data) {
      items.push({
        number: pr.number,
        title: pr.title,
        body: pr.body ?? null,
        headSha: pr.head.sha,
        state: pr.state as 'open' | 'closed',
        // pulls.list 는 merged 별도 필드 없음 — merged_at 으로 판단.
        merged: pr.merged_at !== null,
        authorLogin: pr.user?.login ?? 'unknown',
        authorType: pr.user?.type,
        authorBody: pr.body ?? null,
        additions: 0, // list endpoint 는 stats 미포함 — 0 으로 두고 다음 sync 시 갱신.
        deletions: 0,
        changedFiles: 0,
        createdAt: new Date(pr.created_at),
        updatedAt: new Date(pr.updated_at),
      });
    }
    if (data.length < PER_PAGE) break;
  }
  return items;
}

// PR 의 리뷰 목록 — 사용자가 보낸 변경 요청 (REQUEST_CHANGES) · 승인 (APPROVED) ·
// 코멘트 (COMMENTED) 모두 시간순 정렬해 반환. PR 상세에 이력으로 노출하기 위해.
// dismissed 된 리뷰는 'DISMISSED' state 로 들어옴.
export type PRReviewSummary = {
  id: number;
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING';
  body: string;
  authorLogin: string;
  submittedAt: string | null;
};

export async function listPullReviews(
  installationId: number,
  ref: RepoRef,
  number: number,
): Promise<PRReviewSummary[]> {
  const octokit = await getOctokitForInstallation(installationId);
  const { data } = await octokit.pulls.listReviews({
    owner: ref.owner,
    repo: ref.repo,
    pull_number: number,
    per_page: 100,
  });
  return data.map((r) => ({
    id: r.id,
    state: (r.state as PRReviewSummary['state']) ?? 'COMMENTED',
    body: r.body ?? '',
    authorLogin: r.user?.login ?? 'unknown',
    submittedAt: r.submitted_at ?? null,
  }));
}

// PR 을 머지 없이 닫음 — '폐기' 의미. 사용자가 머지할 가치 없다고 판단한 PR 에 사용.
// state='closed' + merged=false 로 들어가 done 카테고리에 'closed' 로 분류됨.
export async function closePR(
  installationId: number,
  ref: RepoRef,
  number: number,
): Promise<{ closed: boolean; number: number }> {
  const octokit = await getOctokitForInstallation(installationId);
  const { data } = await octokit.pulls.update({
    owner: ref.owner,
    repo: ref.repo,
    pull_number: number,
    state: 'closed',
  });
  return { closed: data.state === 'closed', number: data.number };
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

// Phase 10.1 — .cortex/project.yml · .cortex/roadmap.md 등 임의 파일 fetch.
// default branch 의 raw content. 파일 없으면 null (404). path 는 슬래시 경로 (예: '.cortex/project.yml').
export type RepoFileContent = { content: string; sha: string } | null;

export async function getRepoFileContent(
  installationId: number,
  ref: RepoRef,
  path: string,
): Promise<RepoFileContent> {
  const octokit = await getOctokitForInstallation(installationId);
  try {
    const { data } = await octokit.repos.getContent({
      owner: ref.owner,
      repo: ref.repo,
      path,
    });
    // getContent 는 디렉토리 응답이면 array, 파일이면 object — 파일만 처리.
    if (Array.isArray(data) || data.type !== 'file' || !('content' in data)) {
      return null;
    }
    // GitHub 는 base64 encoded.
    const content = Buffer.from(data.content, 'base64').toString('utf-8');
    return { content, sha: data.sha };
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;
    if (status === 404) return null;
    throw err;
  }
}
