'use client';

// 인앱 토스트 — 액션 결과·자동화 이벤트의 영속 피드백. 기존엔 인라인 메시지가 다음 클릭에
// 사라지고(action feedback vanishes), 백그라운드 자동화는 알림 드롭다운을 열어야만 보였다.
// WebhookListener 가 'notification' SSE 를 받을 때 show() 를 호출해 화면 우하단에 띄운다.
// (브라우저 Notification 과 달리 권한 불필요 — 앱 안에 항상 보임.)

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import Link from 'next/link';
import styles from './Toast.module.css';

export type ToastTone = 'success' | 'error' | 'info';
export type ToastInput = {
  title: string;
  body?: string | null;
  tone?: ToastTone;
  href?: string | null;
};
type Toast = ToastInput & { id: number; tone: ToastTone };

// 한 번에 쌓이는 최대 수 — 넘으면 오래된 것부터 버림.
const MAX_VISIBLE = 4;
// 자동 사라짐 (ms). 실패는 사용자가 읽을 시간을 더 줌.
const DISMISS_MS = 6000;
const DISMISS_MS_ERROR = 10000;

const ToastContext = createContext<(input: ToastInput) => void>(() => {});

// 토스트를 띄우는 함수 반환. Provider 밖에서 호출하면 no-op (안전).
export function useToast(): (input: ToastInput) => void {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const remove = useCallback((id: number) => {
    setToasts((ts) => ts.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (input: ToastInput) => {
      const id = Date.now() + Math.random();
      const tone = input.tone ?? 'info';
      setToasts((ts) => [...ts.slice(-(MAX_VISIBLE - 1)), { ...input, id, tone }]);
      const ttl = tone === 'error' ? DISMISS_MS_ERROR : DISMISS_MS;
      setTimeout(() => remove(id), ttl);
    },
    [remove],
  );

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className={styles.viewport} role="region" aria-label="알림" aria-live="polite">
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onDismiss={() => remove(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const toneClass =
    toast.tone === 'success' ? styles.success : toast.tone === 'error' ? styles.error : styles.info;
  const body = (
    <>
      <span className={styles.title}>{toast.title}</span>
      {toast.body ? <span className={styles.body}>{toast.body}</span> : null}
    </>
  );
  return (
    <div className={`${styles.toast} ${toneClass}`} role="status">
      {toast.href ? (
        <Link href={toast.href} className={styles.content} onClick={onDismiss}>
          {body}
        </Link>
      ) : (
        <div className={styles.content}>{body}</div>
      )}
      <button
        type="button"
        className={styles.close}
        onClick={onDismiss}
        aria-label="닫기"
        title="닫기"
      >
        ×
      </button>
    </div>
  );
}
