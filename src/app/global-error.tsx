'use client';

// 최상위 폴백 — 루트 레이아웃(AppShell 등)이 throw 했을 때만 동작.
// 이 경우 layout 의 globals.css(디자인 시스템 변수)·CSS 모듈을 신뢰할 수 없으므로
// 자체 <html><body> + 인라인 스타일로 다크 테마를 직접 그린다. 최대한 단순하게.

import { useEffect } from 'react';
import { ko as t } from '@/copy/ko';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="ko" data-theme="dark">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          background: '#0e0f11',
          color: '#e7e9ee',
          fontFamily:
            "'Pretendard', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        <div style={{ textAlign: 'center', maxWidth: '420px' }}>
          <h1 style={{ fontSize: '20px', fontWeight: 700, margin: '0 0 8px' }}>
            {t.errors.globalTitle}
          </h1>
          <p style={{ fontSize: '14px', color: '#9aa0aa', margin: '0 0 4px', lineHeight: 1.48 }}>
            {t.errors.globalDesc}
          </p>
          {error.digest ? (
            <p style={{ fontSize: '12px', color: '#9aa0aa', margin: '0 0 16px' }}>
              {t.errors.digest(error.digest)}
            </p>
          ) : (
            <div style={{ height: '16px' }} />
          )}
          <button
            type="button"
            onClick={() => reset()}
            style={{
              cursor: 'pointer',
              border: 'none',
              borderRadius: '8px',
              padding: '10px 16px',
              fontSize: '14px',
              fontWeight: 600,
              background: '#3b82f6',
              color: '#0e0f11',
            }}
          >
            {t.errors.globalRetry}
          </button>
        </div>
      </body>
    </html>
  );
}
