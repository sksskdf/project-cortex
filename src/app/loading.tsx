// 라우트 전환 로딩 폴백 — RSC/DB 가 늦을 때의 빈 화면 깜빡임을 막는다.
// 매 이동마다 뜰 수 있으므로 의도적으로 아주 차분하게: 중앙 정렬 + 옅은 텍스트 + 느린 펄스/스피너.
// (prefers-reduced-motion 에서는 애니메이션 정지 — boundary.module.css 참조.)

import { ko as t } from '@/copy/ko';
import styles from './boundary.module.css';

export default function Loading() {
  return (
    <div className={styles.loading} role="status" aria-live="polite">
      <span className={styles.loadingText}>
        <span className={styles.spinner} aria-hidden="true" />
        {t.errors.loading}
      </span>
    </div>
  );
}
