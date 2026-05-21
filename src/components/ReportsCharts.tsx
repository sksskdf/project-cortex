'use client';

// /reports 페이지의 차트 묶음 — Recharts 사용.
// RSC 인 ReportsPage 가 server-side 에서 데이터를 prep 한 뒤 prop 으로 넘기고,
// 이 컴포넌트가 client-side 에서 ResponsiveContainer + 인터랙티브 시각화 렌더.

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ko as t } from '@/copy/ko';
import styles from './ReportsCharts.module.css';

export type DailyIncomingPoint = { date: string; count: number };
export type DailyMergePoint = { date: string; auto: number; human: number; github: number };
export type DailyConfidencePoint = { date: string; avg: number | null };

const COLOR_BLUE = 'var(--ds-color-state-info-accent)';
const COLOR_YELLOW = 'var(--ds-color-state-warning-accent)';
const COLOR_GRAY = 'var(--ds-color-line-02)';
const COLOR_AXIS = 'var(--ds-color-text-02)';
const COLOR_GRID = 'var(--ds-color-line-02)';

// Recharts 의 Tooltip 기본 스타일은 라이트 모드 가정 — 커스텀 컨텐츠로 대체.
type TooltipProps = {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number | string; color?: string; dataKey?: string }>;
  label?: string;
  totalLabel?: string;
};

function ChartTooltip({ active, payload, label, totalLabel }: TooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const total = payload.reduce(
    (sum, p) => sum + (typeof p.value === 'number' ? p.value : 0),
    0,
  );
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipLabel}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} className={styles.tooltipRow}>
          <span className={styles.tooltipSwatch} style={{ background: p.color }} aria-hidden />
          <span className={styles.tooltipName}>{p.name}</span>
          <span className={styles.tooltipValue}>{p.value ?? '-'}</span>
        </div>
      ))}
      {payload.length > 1 && totalLabel && (
        <div className={styles.tooltipTotal}>
          {totalLabel} {total}
        </div>
      )}
    </div>
  );
}

function shortDate(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${Number(m)}/${Number(d)}`;
}

export function DailyIncomingChart({ points }: { points: DailyIncomingPoint[] }) {
  const data = points.map((p) => ({ date: shortDate(p.date), count: p.count }));
  return (
    <div className={styles.chartWrap}>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={COLOR_GRID} vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="date" stroke={COLOR_AXIS} fontSize={11} tickLine={false} />
          <YAxis stroke={COLOR_AXIS} fontSize={11} tickLine={false} allowDecimals={false} width={28} />
          <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} content={<ChartTooltip />} />
          <Bar dataKey="count" name={t.reports.section.dailyIncoming} fill={COLOR_BLUE} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DailyMergeChart({ points }: { points: DailyMergePoint[] }) {
  const data = points.map((p) => ({
    date: shortDate(p.date),
    auto: p.auto,
    human: p.human,
    github: p.github,
  }));
  return (
    <div className={styles.chartWrap}>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={COLOR_GRID} vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="date" stroke={COLOR_AXIS} fontSize={11} tickLine={false} />
          <YAxis stroke={COLOR_AXIS} fontSize={11} tickLine={false} allowDecimals={false} width={28} />
          <Tooltip
            cursor={{ fill: 'rgba(255,255,255,0.04)' }}
            content={<ChartTooltip totalLabel="합계" />}
          />
          <Legend
            iconType="square"
            iconSize={10}
            wrapperStyle={{ fontSize: 11, paddingTop: 4 }}
          />
          <Bar dataKey="auto" name={t.reports.legend.auto} stackId="m" fill={COLOR_BLUE} />
          <Bar dataKey="human" name={t.reports.legend.human} stackId="m" fill={COLOR_YELLOW} />
          <Bar
            dataKey="github"
            name={t.reports.legend.github}
            stackId="m"
            fill={COLOR_GRAY}
            radius={[3, 3, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function AvgConfidenceChart({ points }: { points: DailyConfidencePoint[] }) {
  const data = points.map((p) => ({ date: shortDate(p.date), avg: p.avg }));
  // null 인 일자가 있어도 connectNulls=false 로 자연스러운 gap.
  return (
    <div className={styles.chartWrap}>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={COLOR_GRID} vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="date" stroke={COLOR_AXIS} fontSize={11} tickLine={false} />
          <YAxis
            stroke={COLOR_AXIS}
            fontSize={11}
            tickLine={false}
            domain={[0, 100]}
            width={28}
          />
          <Tooltip cursor={{ stroke: COLOR_GRID }} content={<ChartTooltip />} />
          <Line
            type="monotone"
            dataKey="avg"
            name={t.reports.section.avgConfidence}
            stroke={COLOR_BLUE}
            strokeWidth={2}
            dot={{ r: 3, fill: COLOR_BLUE, strokeWidth: 0 }}
            activeDot={{ r: 5 }}
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
