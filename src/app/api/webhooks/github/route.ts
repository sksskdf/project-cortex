import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { events } from '@/lib/events';
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
  // ping / push / 기타 이벤트 — 의도적 무시. 200으로 응답해야 GitHub가 재시도 안 함.
  return NextResponse.json({ ok: true, skipped: eventName ?? 'no-event-header' });
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
