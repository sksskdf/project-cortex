import { NextResponse } from 'next/server';
import { allWebhookSecrets } from '@/lib/github-apps';
import { broadcast as broadcastEvent, events } from '@/lib/events';
import { handlePushEvent, isCortexSyncCommit } from '@/lib/project-meta';
import { logger } from '@/lib/logger';
import { handleCheckWebhook, handlePullRequestWebhook } from '@/lib/sync';
import { attemptAddressReview } from '@/lib/review-fix';
import {
  mapCheckEvent,
  mapPullRequestEvent,
  mapReviewEvent,
  type GithubCheckEventPartial,
  type GithubPullRequestEventPartial,
  type GithubReviewEventPartial,
} from '@/lib/webhook-payload';
import { verifyGithubSignatureAny } from '@/lib/webhook-verify';

// webhook은 매 요청 처리 — static 캐싱 차단.
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get('x-hub-signature-256');

  if (!verifyGithubSignatureAny(rawBody, signature, allWebhookSecrets())) {
    logger.warn({ source: 'webhook/github' }, 'rejected webhook with invalid signature');
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  const eventName = req.headers.get('x-github-event');
  logger.debug({ source: 'webhook/github', event: eventName }, 'received webhook');
  if (eventName === 'pull_request') {
    return handlePullRequest(rawBody);
  }
  if (eventName === 'check_run' || eventName === 'check_suite') {
    return handleCheck(rawBody);
  }
  if (eventName === 'push') {
    return handlePush(rawBody);
  }
  if (eventName === 'pull_request_review') {
    return handleReview(rawBody);
  }
  // ping / 기타 이벤트 — 의도적 무시. 200으로 응답해야 GitHub가 재시도 안 함.
  return NextResponse.json({ ok: true, skipped: eventName ?? 'no-event-header' });
}

// Phase 10.2 — push event 의 commits 가 `.cortex/` 디렉토리 파일을 건드렸으면 자동 sync.
// default branch push 만, AI 분석은 트리거 X.
type GithubPushEventPartial = {
  ref?: string;
  repository?: { full_name?: string; default_branch?: string };
  installation?: { id?: number };
  commits?: ReadonlyArray<{
    message?: string;
    modified?: ReadonlyArray<string>;
    added?: ReadonlyArray<string>;
    removed?: ReadonlyArray<string>;
  }>;
};

async function handlePush(rawBody: string) {
  let event: GithubPushEventPartial;
  try {
    event = JSON.parse(rawBody) as GithubPushEventPartial;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const slug = event.repository?.full_name;
  const installationId = event.installation?.id;
  const defaultBranch = event.repository?.default_branch;
  const ref = event.ref;
  if (!slug || !installationId || !defaultBranch || !ref) {
    return NextResponse.json({ ok: true, skipped: 'incomplete-push-event' });
  }

  // default branch 만 — feature 브랜치 push 는 사용자 작업 중일 가능성, 무시.
  if (ref !== `refs/heads/${defaultBranch}`) {
    return NextResponse.json({ ok: true, skipped: 'non-default-branch' });
  }

  // 변경 path 중 `.cortex/` 시작 있는지 — 아니면 sync 안 함 (다른 push 는 PR 흐름만).
  const allPaths = (event.commits ?? []).flatMap((c) => [
    ...(c.modified ?? []),
    ...(c.added ?? []),
    ...(c.removed ?? []),
  ]);
  const touchesCortex = allPaths.some((p) => p.startsWith('.cortex/'));
  if (!touchesCortex) {
    return NextResponse.json({ ok: true, skipped: 'no-cortex-change' });
  }

  // Phase 10.4 — 무한 루프 방지. .cortex 를 건드린 commit 이 전부 Cortex 자신이 만든
  // 것(Cortex-Sync 마커)이면 git→Cortex sync 를 skip — Cortex→git→Cortex 루프 차단.
  const cortexTouchingCommits = (event.commits ?? []).filter((c) =>
    [...(c.modified ?? []), ...(c.added ?? []), ...(c.removed ?? [])].some((p) =>
      p.startsWith('.cortex/'),
    ),
  );
  const allCortexAuthored =
    cortexTouchingCommits.length > 0 &&
    cortexTouchingCommits.every((c) => isCortexSyncCommit(c.message ?? ''));
  if (allCortexAuthored) {
    return NextResponse.json({ ok: true, skipped: 'cortex-authored-sync' });
  }

  try {
    const result = await handlePushEvent({ slug, installationId });
    if (result.kind === 'synced') broadcastEvent({ type: 'sync' });
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    logger.error({ source: 'webhook/github', event: 'push', slug, err }, 'handlePushEvent failed');
    return NextResponse.json({ error: 'push handler failed' }, { status: 500 });
  }
}

async function handlePullRequest(rawBody: string) {
  let event: GithubPullRequestEventPartial;
  try {
    event = JSON.parse(rawBody) as GithubPullRequestEventPartial;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const payload = mapPullRequestEvent(event);
  if (!payload) {
    return NextResponse.json({ ok: true, skipped: `action:${event.action}` });
  }

  try {
    const result = await handlePullRequestWebhook(payload);
    if (result.kind === 'inserted' || result.kind === 'updated') {
      events.emit('sync', { type: 'sync', prId: result.prId, kind: result.kind });
    }
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    logger.error(
      { source: 'webhook/github', event: 'pull_request', number: payload.pr.number, err },
      'pull_request sync failed',
    );
    return NextResponse.json({ error: 'sync failed' }, { status: 500 });
  }
}

async function handleCheck(rawBody: string) {
  let event: GithubCheckEventPartial;
  try {
    event = JSON.parse(rawBody) as GithubCheckEventPartial;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const payload = mapCheckEvent(event);
  if (!payload) {
    return NextResponse.json({ ok: true, skipped: `action:${event.action}` });
  }

  try {
    const result = await handleCheckWebhook(payload);
    if (result.kind === 'updated') {
      // CI 결과로 testsPassed 가 갱신됐다는 신호 — 자동 머지가 트리거됐을 수도 있음.
      // 클라이언트가 PR 상세를 보고 있다면 화면 새로고침 가치 있음.
      events.emit('sync', { type: 'sync', prId: result.prId, kind: 'updated' });
    }
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    logger.error(
      { source: 'webhook/github', event: 'check', headSha: payload.headSha, err },
      'check sync failed',
    );
    return NextResponse.json({ error: 'sync failed' }, { status: 500 });
  }
}

// Phase 13.1 — changes_requested 리뷰 자동 반영. claude 수정은 수 분 걸릴 수 있어 응답을
// 막지 않도록 best-effort 백그라운드로 띄우고 즉시 200. 토글 OFF(디폴트)면 즉시 skip.
async function handleReview(rawBody: string) {
  let event: GithubReviewEventPartial;
  try {
    event = JSON.parse(rawBody) as GithubReviewEventPartial;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const payload = mapReviewEvent(event);
  if (!payload) {
    return NextResponse.json({
      ok: true,
      skipped: `review:${event.action}/${event.review?.state ?? '?'}`,
    });
  }

  attemptAddressReview({
    repoSlug: payload.repoSlug,
    prNumber: payload.prNumber,
    feedback: payload.body,
    reviewer: payload.reviewer,
  }).catch((err) => {
    logger.error(
      { source: 'webhook/github', event: 'pull_request_review', number: payload.prNumber, err },
      'attemptAddressReview unexpected error',
    );
  });
  return NextResponse.json({ ok: true, queued: payload.prNumber });
}
