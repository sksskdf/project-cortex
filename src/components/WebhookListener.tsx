'use client';

// SSE 로 /api/events 에 연결해 webhook 이 들어올 때마다 router.refresh().
// 폴링 대비 장점: 변경 없으면 트래픽 0, 새 PR 도착 즉시(<1s) 화면 갱신.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// GitHub 가 같은 PR 의 여러 이벤트 (opened → labeled → synchronize) 를 짧은 간격에
// 연속 발송하는 경우가 흔함. 매번 router.refresh() 하면 RSC 트리가 N 번 재마운트
// 되어 화면이 깜빡임. 마지막 sync 후 이 시간만큼 잠잠하면 한 번만 refresh.
const REFRESH_DEBOUNCE_MS = 400;

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
        const data = JSON.parse(e.data) as { type: string };
        if (data.type === 'sync') {
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
