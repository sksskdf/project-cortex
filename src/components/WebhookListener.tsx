'use client';

// SSE 로 /api/events 에 연결해 webhook 이 들어올 때마다 router.refresh().
// 폴링 대비 장점: 변경 없으면 트래픽 0, 새 PR 도착 즉시(<1s) 화면 갱신.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export function WebhookListener() {
  const router = useRouter();
  useEffect(() => {
    const source = new EventSource('/api/events');
    source.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as { type: string };
        if (data.type === 'sync') {
          router.refresh();
        }
      } catch {
        // payload 가 JSON 이 아니면 무시.
      }
    };
    // EventSource 는 끊기면 자동 재연결 — 별도 처리 불필요.
    return () => source.close();
  }, [router]);
  return null;
}
