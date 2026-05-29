'use client';

// Phase 20 — "최근 머지 N 미확인" 이 쌓였을 때 한 번에 확인 처리. 이미 검토 끝난 자동 머지
// 백로그를 일괄 정리.

import { useTransition } from 'react';
import { ko as t } from '@/copy/ko';
import { markAllMergedReadAction } from '@/actions/pr';
import styles from './MarkAllReadButton.module.css';

export function MarkAllReadButton({ count }: { count: number }) {
  const [pending, startTransition] = useTransition();
  if (count <= 0) return null;
  return (
    <button
      type="button"
      className={styles.btn}
      disabled={pending}
      onClick={() => startTransition(() => void markAllMergedReadAction())}
      title={t.dashboard.section.markAllRead}
    >
      {t.dashboard.section.markAllRead}
    </button>
  );
}
