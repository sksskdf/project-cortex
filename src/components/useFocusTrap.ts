'use client';

// Phase 15 (A7) — 모달 접근성 공용 훅.
// 모달/다이얼로그가 열려 있는 동안:
//  1) 포커스 트랩 — Tab/Shift+Tab 이 다이얼로그 안에서만 순환 (배경으로 새지 않음)
//  2) 초기 포커스 — 열릴 때 첫 포커서블 요소(없으면 컨테이너 자체)로 이동
//  3) Escape 닫기 — Escape 키로 onClose 호출
//  4) 포커스 복원 — 닫힐 때 모달을 연 요소로 포커스 되돌림
// 컨테이너 ref 를 다이얼로그 루트 요소에 연결해 사용한다.
//
// 키보드 동작만 다루며 스타일/마크업은 건드리지 않는다. 각 모달이 직접 복붙하던
// Escape 리스너 로직을 한곳으로 모은다.

import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

export type FocusTrapOptions = {
  // Escape 키 또는 트랩 종료 시 호출되는 닫기 핸들러.
  onClose: () => void;
  // 초기 포커스를 자동으로 옮길지 여부. autoFocus 를 이미 쓰는 폼이면 false 로 끌 수 있다.
  // 기본값 true.
  autoFocus?: boolean;
};

/**
 * 모달 다이얼로그용 포커스 관리 훅.
 *
 * 반환된 ref 를 다이얼로그 루트 요소에 연결하면 마운트되어 있는 동안
 * 포커스 트랩 + 초기 포커스 + Escape 닫기 + 포커스 복원이 활성화된다.
 * 컴포넌트가 조건부로 마운트/언마운트되는 패턴(`open ? <Modal/> : null`)을 전제로 한다.
 */
export function useFocusTrap<T extends HTMLElement = HTMLDivElement>({
  onClose,
  autoFocus = true,
}: FocusTrapOptions) {
  const containerRef = useRef<T>(null);
  // 최신 onClose 를 참조하되, effect 가 매번 재실행되지 않도록 ref 에 보관.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 모달을 연 요소를 저장해 두었다가 닫힐 때 복원.
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // 초기 포커스 — 첫 포커서블 요소, 없으면 컨테이너 자체(tabIndex 필요).
    if (autoFocus) {
      const focusable = getFocusable(container);
      const target = focusable[0] ?? container;
      // 컨테이너로 포커스해야 하는데 tabindex 가 없으면 임시 부여.
      if (target === container && !container.hasAttribute('tabindex')) {
        container.setAttribute('tabindex', '-1');
      }
      target.focus();
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;

      const node = containerRef.current;
      if (!node) return;
      const focusable = getFocusable(node);
      if (focusable.length === 0) {
        // 포커서블 요소가 없으면 컨테이너 밖으로 새지 않도록 차단.
        e.preventDefault();
        node.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;

      if (e.shiftKey) {
        // Shift+Tab: 첫 요소(또는 컨테이너 밖)에서 마지막으로 순환.
        if (active === first || active === node || !node.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        // Tab: 마지막 요소(또는 컨테이너 밖)에서 첫 요소로 순환.
        if (active === last || active === node || !node.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    // 캡처 단계에서 처리해 내부 요소의 자체 핸들러보다 트랩이 먼저 동작하도록.
    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      // 포커스 복원 — 모달을 연 요소가 아직 문서에 있으면 되돌림.
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
    // onClose 는 ref 로 처리하므로 의존성에서 제외. autoFocus 변경 시 재설정.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus]);

  return containerRef;
}
