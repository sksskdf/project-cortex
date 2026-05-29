'use client';

// 프로젝트 토글 공용 훅 — 낙관적 DB 값 + 트랜지션 + 액션 결과(에러/성공) 보관.
// 7개 토글이 복붙하던 useOptimistic/useTransition/onToggle/에러 보일러플레이트를 한 곳으로.

import { useOptimistic, useState, useTransition } from 'react';

// 모든 프로젝트 토글 서버 액션의 공통 결과 형태. 'updated' 변형이 추가 필드(id·enabled·
// retriagedCount 등)를 더 가져도 구조적으로 이 타입에 할당된다.
export type ToggleActionResult =
  | { kind: 'idle' | 'updated' | 'not-found' }
  | { kind: 'error'; message: string };

export function useOptimisticToggle<R extends { kind: string }>(
  initial: boolean,
  action: (next: boolean) => Promise<R>,
): {
  // 낙관적 DB 값 (토글이 추적하는 raw 값 — mute 는 muted, 나머지는 enabled).
  value: boolean;
  pending: boolean;
  result: R | { kind: 'idle' };
  toggle: (next: boolean) => void;
} {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<R | { kind: 'idle' }>({ kind: 'idle' });
  const [value, setValue] = useOptimistic(initial, (_current, next: boolean) => next);

  function toggle(next: boolean) {
    setResult({ kind: 'idle' });
    startTransition(async () => {
      setValue(next);
      setResult(await action(next));
    });
  }

  return { value, pending, result, toggle };
}
