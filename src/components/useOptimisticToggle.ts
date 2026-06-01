'use client';

// 프로젝트 토글 공용 훅 — 낙관적 DB 값 + 트랜지션 + 액션 결과(에러/성공) 보관.
// 7개 토글이 복붙하던 useOptimistic/useTransition/onToggle/에러 보일러플레이트를 한 곳으로.

import { useOptimistic, useRef, useState, useTransition } from 'react';

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

  // Phase 15 B5 — 동시 클릭 race 가드. 이전 토글이 in-flight 인 동안 들어온 클릭을 무시한다.
  // useTransition 의 pending 만으로는 같은 사이클의 빠른 더블클릭을 못 막아(상태 갱신 전), ref 로
  // 동기 잠금하고 액션 완료 시 해제. 첫 클릭을 직렬화해 서버 상태와 낙관 값 어긋남(깜빡임) 방지.
  const inFlightRef = useRef(false);

  function toggle(next: boolean) {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setResult({ kind: 'idle' });
    startTransition(async () => {
      setValue(next);
      try {
        setResult(await action(next));
      } finally {
        inFlightRef.current = false;
      }
    });
  }

  return { value, pending, result, toggle };
}
