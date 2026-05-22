import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { broadcast as broadcastEvent, events } from '@/lib/events';
import { handlePushEvent } from '@/lib/project-meta';
import { handleCheckWebhook, handlePullRequestWebhook } from '@/lib/sync';
import {
  mapCheckEvent,
  mapPullRequestEvent,
  type GithubCheckEventPartial,
  type GithubPullRequestEventPartial,
} from '@/lib/webhook-payload';
import { verifyGithubSignature } from '@/lib/webhook-verify';

// webhook은 매 요청 처리 — static 캐싱 차단.
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get('x-hub-signature-256');

  if (!verifyGithubSignature(rawBody, signature, env.githubWebhookSecret())) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  const eventName = req.headers.get('x-github-event');
  if (eventName === 'pull_request') {
    return handlePullRequest(rawBody);
  }
  if (eventName === 'check_run' || eventName === 'check_suite') {
    return handleCheck(rawBody);
  }
  if (eventName === 'push') {
    return handlePush(rawBody);
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

  try {
    const result = await handlePushEvent({ slug, installationId });
    if (result.kind === 'synced') broadcastEvent({ type: 'sync' });
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    console.error('handlePushEvent failed:', err);
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
    console.error('[webhook/github] pull_request sync failed', err);
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
    console.error('[webhook/github] check sync failed', err);
    return NextResponse.json({ error: 'sync failed' }, { status: 500 });
  }
}
