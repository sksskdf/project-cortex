// Phase 14 — 요소 단위 contextual 도움말. 감싼 요소에 hover/focus 하면 인라인 설명 툴팁이 뜬다.
// 순수 CSS(:hover/:focus-within) 라 클라이언트 JS 불필요(서버 컴포넌트에서도 사용 가능). 기존
// 컨트롤은 대개 aria-label 이 있어 SR 은 커버되고, 이건 sighted 사용자용 가시 힌트 + role=tooltip.

import type { ReactNode } from 'react';
import styles from './InfoTip.module.css';

export function InfoTip({
  text,
  children,
  className,
}: {
  text: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={`${styles.wrap} ${className ?? ''}`}>
      {children}
      <span role="tooltip" className={styles.tip}>
        {text}
      </span>
    </span>
  );
}
