// 작은 SVG 막대 차트 — Phase 7 /reports 페이지의 일별 카운트용.
// 라이브러리 없이 직접 그려서 의존성 0. stacked / single 두 모드 지원.

import styles from './MiniBarChart.module.css';

type BarSegment = {
  value: number;
  className: string;
};

export type MiniBarChartItem = {
  label: string;
  segments: BarSegment[];
  total: number;
};

export function MiniBarChart({
  items,
  height = 120,
  ariaLabel,
}: {
  items: MiniBarChartItem[];
  height?: number;
  ariaLabel: string;
}) {
  if (items.length === 0) {
    return <div className={styles.empty}>—</div>;
  }
  const maxTotal = Math.max(1, ...items.map((it) => it.total));
  const barAreaHeight = height - 22; // x축 라벨 자리.

  return (
    <div className={styles.wrap} role="img" aria-label={ariaLabel}>
      <div className={styles.bars} style={{ height: `${barAreaHeight}px` }}>
        {items.map((item, idx) => {
          const totalRatio = item.total / maxTotal;
          return (
            <div key={idx} className={styles.barCol} title={`${item.label}: ${item.total}`}>
              <div
                className={styles.barStack}
                style={{ height: `${totalRatio * 100}%` }}
                aria-hidden="true"
              >
                {item.segments.map((seg, i) =>
                  seg.value > 0 ? (
                    <div
                      key={i}
                      className={`${styles.barSegment} ${seg.className}`}
                      style={{ flexGrow: seg.value }}
                    />
                  ) : null,
                )}
              </div>
              {item.total > 0 && <span className={styles.barValue}>{item.total}</span>}
            </div>
          );
        })}
      </div>
      <div className={styles.axis}>
        {items.map((item, idx) => (
          <span key={idx} className={styles.axisLabel}>
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}
