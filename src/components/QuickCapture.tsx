'use client';

// Phase 21 (G3) — 비선형 요청 quick-capture. 다른 작업 중 떠오른 요청·아이디어를 사이드바에서
// 어느 화면에서든 즉시 한 줄 캡처 → 할 일(todos)로 저장. 분류(이슈 승격·완료·삭제)는 /todos 에서.
// "요청이 누락되는 패턴 자체"를 흡수하는 메타 기능. todos 인프라 재사용(새 테이블 없음).

import { useRef, useState, useTransition } from 'react';
import { ko as t } from '@/copy/ko';
import { createTodoAction } from '@/actions/todos';
import styles from './QuickCapture.module.css';

export function QuickCapture() {
  const c = t.nav.quickCapture;
  const [value, setValue] = useState('');
  const [flash, setFlash] = useState(false);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const title = value.trim();
    if (title.length === 0 || pending) return;
    setValue('');
    startTransition(async () => {
      const r = await createTodoAction({ title });
      if (r.kind === 'created') {
        setFlash(true);
        setTimeout(() => setFlash(false), 1600);
        inputRef.current?.focus();
      } else {
        // 실패 시 입력 복원 — 사용자가 잃지 않게.
        setValue(title);
      }
    });
  }

  return (
    <form className={styles.wrap} onSubmit={submit} aria-label={c.ariaLabel}>
      <input
        ref={inputRef}
        type="text"
        className={styles.input}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={flash ? c.captured : c.placeholder}
        aria-label={c.ariaLabel}
        disabled={pending}
      />
      <button
        type="submit"
        className={styles.btn}
        disabled={pending || value.trim().length === 0}
        aria-label={c.add}
        title={c.add}
      >
        +
      </button>
    </form>
  );
}
