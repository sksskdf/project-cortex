'use client';

// 카드 '자동화' 섹션의 공용 스위치 행 — 좌측 라벨 + 우측 iOS 스타일 토글.
// 표현(presentational)만 담당: checked / busy / disabled / 인라인 에러를 prop 으로 받고
// 실제 상태·서버 액션·낙관적 업데이트는 호출하는 토글 컴포넌트가 가진다.

import styles from './ToggleSwitch.module.css';

export function ToggleSwitch({
  label,
  checked,
  onToggle,
  busy = false,
  disabled = false,
  ariaLabel,
  error,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
  busy?: boolean;
  disabled?: boolean;
  ariaLabel: string;
  error?: string;
}) {
  return (
    <div className={styles.row}>
      <div className={styles.line}>
        <span className={styles.label}>{label}</span>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-busy={busy}
          disabled={disabled || busy}
          onClick={onToggle}
          aria-label={ariaLabel}
          title={ariaLabel}
          className={`${styles.track} ${checked ? styles.trackOn : styles.trackOff}`}
        >
          <span className={styles.knob} aria-hidden />
          <span className={styles.state} aria-hidden>
            {checked ? 'ON' : 'OFF'}
          </span>
        </button>
      </div>
      {error ? (
        <span className={styles.error} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
