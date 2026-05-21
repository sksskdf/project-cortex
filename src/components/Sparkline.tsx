// SVG 라인 + 점 — 일별 평균 신뢰 점수 추이용. null point 는 gap 으로 처리.

import styles from './Sparkline.module.css';

export type SparklinePoint = {
  label: string;
  value: number | null;
};

export function Sparkline({
  points,
  ariaLabel,
  height = 80,
}: {
  points: SparklinePoint[];
  ariaLabel: string;
  height?: number;
}) {
  if (points.length === 0) {
    return <div className={styles.empty}>—</div>;
  }
  const vals = points.map((p) => p.value).filter((v): v is number => v !== null);
  const max = vals.length > 0 ? Math.max(...vals) : 100;
  const min = vals.length > 0 ? Math.min(...vals) : 0;
  const range = Math.max(1, max - min);
  const padTop = 10;
  const padBottom = 22;
  const innerHeight = height - padTop - padBottom;
  const stepX = points.length > 1 ? 100 / (points.length - 1) : 0;

  // path 구성 — null 만나면 'M' 으로 끊어 gap 처리.
  let path = '';
  let lastBroken = true;
  points.forEach((p, idx) => {
    if (p.value === null) {
      lastBroken = true;
      return;
    }
    const x = idx * stepX;
    const y = padTop + (1 - (p.value - min) / range) * innerHeight;
    path += `${lastBroken ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)} `;
    lastBroken = false;
  });

  return (
    <div className={styles.wrap} role="img" aria-label={ariaLabel}>
      <svg
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        className={styles.svg}
        height={height}
      >
        <path d={path.trim()} className={styles.line} />
        {points.map((p, idx) => {
          if (p.value === null) return null;
          const x = idx * stepX;
          const y = padTop + (1 - (p.value - min) / range) * innerHeight;
          return (
            <circle
              key={idx}
              cx={x}
              cy={y}
              r={1.4}
              className={styles.dot}
              vectorEffect="non-scaling-stroke"
            >
              <title>{`${p.label}: ${p.value}`}</title>
            </circle>
          );
        })}
      </svg>
      <div className={styles.axis}>
        {points.map((p, idx) => (
          <span key={idx} className={styles.axisLabel}>
            {p.label}
          </span>
        ))}
      </div>
    </div>
  );
}
