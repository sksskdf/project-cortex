import { events, type CortexEvent } from '@/lib/events';

// SSE 스트림 — 클라이언트가 EventSource 로 연결, webhook sync 가 일어날 때마다 push.
// 폴링 대비 장점: 변경 없으면 트래픽 0, 변경 즉시 알림.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  let onSync: ((payload: CortexEvent) => void) | null = null;
  let keepalive: NodeJS.Timeout | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (data: CortexEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // controller 가 이미 닫혔으면 무시 — cancel 에서 cleanup.
        }
      };

      onSync = (payload) => {
        if (payload.type === 'sync') send(payload);
      };
      events.on('sync', onSync);

      // 연결 직후 신호.
      send({ type: 'connected' });

      // 프록시(cloudflared 등) 가 무응답 연결을 끊지 않게 30초마다 주석 라인.
      keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: keepalive\n\n`));
        } catch {
          if (keepalive) clearInterval(keepalive);
        }
      }, 30_000);
    },
    cancel() {
      if (onSync) events.off('sync', onSync);
      if (keepalive) clearInterval(keepalive);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // cloudflared/nginx 같은 프록시가 압축으로 버퍼링하지 않게.
      'X-Accel-Buffering': 'no',
    },
  });
}
