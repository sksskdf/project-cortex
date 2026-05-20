import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { events } from '@/lib/events';
import { handlePullRequestWebhook } from '@/lib/sync';
import { mapPullRequestEvent, type GithubPullRequestEventPartial } from '@/lib/webhook-payload';
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
  if (eventName !== 'pull_request') {
    // ping / push / 기타 이벤트 — 의도적 무시. 200으로 응답해야 GitHub가 재시도 안 함.
    return NextResponse.json({ ok: true, skipped: eventName ?? 'no-event-header' });
  }

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
    // 성공한 insert/update 만 push — skip 은 무의미한 새로고침이라 emit X.
    if (result.kind === 'inserted' || result.kind === 'updated') {
      events.emit('sync', { type: 'sync', prId: result.prId, kind: result.kind });
    }
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    // 사용자 노출 X — 로그만. 5xx로 응답하면 GitHub가 재시도 → 멱등성 의존.
    console.error('[webhook/github] sync failed', err);
    return NextResponse.json({ error: 'sync failed' }, { status: 500 });
  }
}
