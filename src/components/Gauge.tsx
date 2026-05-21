import type { GaugeTier } from '@/lib/types';
import styles from './Gauge.module.css';

// 사용자 보고: 게이지가 갑갑해 보임. radius 줄이고 stroke 두껍게 → 시각적 여백 확보.
const SIZE = {
  sm: { box: 40, center: 20, radius: 15, strokeWidth: 4 },
  md: { box: 52, center: 26, radius: 19, strokeWidth: 5 },
} as const;

const barClass: Record<GaugeTier, string> = {
  success: styles.barSuccess,
  blue: styles.barBlue,
  warning: styles.barWarning,
  error: styles.barError,
};

export function Gauge({
  value,
  tier,
  size = 'md',
}: {
  value: number;
  tier: GaugeTier;
  size?: 'sm' | 'md';
}) {
  const dims = SIZE[size];
  const circumference = 2 * Math.PI * dims.radius;
  const offset = circumference - (value / 100) * circumference;
  const wrapClass = `${styles.gauge} ${size === 'sm' ? styles.gaugeSm : styles.gaugeMd}`;
  const labelClass = `${styles.label} ${size === 'sm' ? styles.labelSm : styles.labelMd}`;

  return (
    <div className={wrapClass}>
      <svg
        className={styles.svg}
        width={dims.box}
        height={dims.box}
        viewBox={`0 0 ${dims.box} ${dims.box}`}
      >
        <circle
          className={styles.track}
          cx={dims.center}
          cy={dims.center}
          r={dims.radius}
          strokeWidth={dims.strokeWidth}
        />
        <circle
          className={`${styles.bar} ${barClass[tier]}`}
          cx={dims.center}
          cy={dims.center}
          r={dims.radius}
          strokeWidth={dims.strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <span className={labelClass}>{value}</span>
    </div>
  );
}
