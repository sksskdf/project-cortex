'use client';

// SSE 로 /api/events 에 연결해 webhook 이 들어올 때마다 router.refresh().
// 폴링 대비 장점: 변경 없으면 트래픽 0, 새 PR 도착 즉시(<1s) 화면 갱신.
// Phase 10.2 후속 — 'notification' 채널 받으면 브라우저 Notification 표시
// (사용자 시그널: "PR 발생하면 브라우저에서 알림").

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getBrowserNotifyPref } from '@/lib/notify-pref';

// GitHub 가 같은 PR 의 여러 이벤트 (opened → labeled → synchronize) 를 짧은 간격에
// 연속 발송하는 경우가 흔함. 매번 router.refresh() 하면 RSC 트리가 N 번 재마운트
// 되어 화면이 깜빡임. 마지막 sync 후 이 시간만큼 잠잠하면 한 번만 refresh.
const REFRESH_DEBOUNCE_MS = 400;

type SsePayload =
  | { type: 'sync' | 'connected' }
  | {
      type: 'notification';
      kind: string;
      title: string;
      body: string | null;
      href: string | null;
    };

export function WebhookListener() {
  const router = useRouter();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        router.refresh();
        timer = null;
      }, REFRESH_DEBOUNCE_MS);
    };

    const source = new EventSource('/api/events');
    source.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as SsePayload;
        if (data.type === 'sync') {
          scheduleRefresh();
        } else if (data.type === 'notification') {
          // 권한 granted + 앱 토글 ON 일 때만 표시. 미설정/거부/토글 OFF 면 조용히 skip.
          if (
            typeof Notification !== 'undefined' &&
            Notification.permission === 'granted' &&
            getBrowserNotifyPref()
          ) {
            const n = new Notification(data.title, {
              body: data.body ?? undefined,
              tag: `cortex-${data.kind}-${data.href ?? ''}`, // 같은 PR 의 연속 알림 합침
            });
            if (data.href) {
              n.onclick = () => {
                window.focus();
                window.location.href = data.href!;
                n.close();
              };
            }
          }
          // 화면도 같이 갱신 — 알림 드롭다운의 unread 배지 +1.
          scheduleRefresh();
        }
      } catch {
        // payload 가 JSON 이 아니면 무시.
      }
    };
    // EventSource 는 끊기면 자동 재연결 — 별도 처리 불필요.
    return () => {
      if (timer) clearTimeout(timer);
      source.close();
    };
  }, [router]);
  return null;
}
