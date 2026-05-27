'use client';

// /reports 페이지의 차트 묶음 — Recharts 사용.
// RSC 인 ReportsPage 가 server-side 에서 데이터를 prep 한 뒤 prop 으로 넘기고,
// 이 컴포넌트가 client-side 에서 ResponsiveContainer + 인터랙티브 시각화 렌더.

import { useMemo } from 'react';
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

// 차트 색상 — Recharts 가 SVG fill attribute 에 CSS var() 를 일부 브라우저에서
// 검정 fallback 으로 처리하는 케이스 회피. 디자인 토큰(--ds-color-*) 값을 런타임에
// getComputedStyle 로 읽어 실제 hex 문자열로 변환해 넘긴다(AgentConsole.cssVar 패턴).
// SSR/마운트 전엔 getComputedStyle 이 없으므로 dark.css 토큰과 동일한 hex 를 fallback 으로 둔다.
function cssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

// 차트가 쓰는 토큰을 한 번에 해석. 각 차트 컴포넌트가 useMemo 로 호출(렌더 시 클라이언트에서 평가).
function useChartColors() {
  return useMemo(
    () => ({
      blue: cssVar('--ds-color-secondary-01', '#93b0f8'), // 자동 머지 (brand blue)
      yellow: cssVar('--ds-color-state-warning-base', '#ffc60a'), // 수동 머지
      gray: cssVar('--ds-color-primary-03', '#6c728f'), // 외부 머지
      axis: cssVar('--ds-color-text-02', '#9aa0c2'), // 축 라벨
      grid: cssVar('--ds-color-line-02', '#252a45'), // 격자선
      // hover 영역 — 정확히 대응하는 단일 토큰이 없어 기존 highlight 값 유지.
      tooltipCursor: 'rgba(180, 199, 246, 0.06)',
    }),
    [],
  );
}

// Recharts 의 Tooltip 기본 스타일은 라이트 모드 가정 — 커스텀 컨텐츠로 대체.
type TooltipProps = {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number | string; color?: string; dataKey?: string }>;
  label?: string;
  totalLabel?: string;
};

function ChartTooltip({ active, payload, label, totalLabel }: TooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const total = payload.reduce((sum, p) => sum + (typeof p.value === 'number' ? p.value : 0), 0);
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
  const colors = useChartColors();
  const data = points.map((p) => ({ date: shortDate(p.date), count: p.count }));
  return (
    <div className={styles.chartWrap}>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={colors.grid} vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="date" stroke={colors.axis} fontSize={11} tickLine={false} />
          <YAxis
            stroke={colors.axis}
            fontSize={11}
            tickLine={false}
            allowDecimals={false}
            width={28}
          />
          <Tooltip cursor={{ fill: colors.tooltipCursor }} content={<ChartTooltip />} />
          <Bar
            dataKey="count"
            name={t.reports.section.dailyIncoming}
            fill={colors.blue}
            radius={[3, 3, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DailyMergeChart({ points }: { points: DailyMergePoint[] }) {
  const colors = useChartColors();
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
          <CartesianGrid stroke={colors.grid} vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="date" stroke={colors.axis} fontSize={11} tickLine={false} />
          <YAxis
            stroke={colors.axis}
            fontSize={11}
            tickLine={false}
            allowDecimals={false}
            width={28}
          />
          <Tooltip
            cursor={{ fill: colors.tooltipCursor }}
            content={<ChartTooltip totalLabel="합계" />}
          />
          <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 11, paddingTop: 4 }} />
          <Bar dataKey="auto" name={t.reports.legend.auto} stackId="m" fill={colors.blue} />
          <Bar dataKey="human" name={t.reports.legend.human} stackId="m" fill={colors.yellow} />
          <Bar
            dataKey="github"
            name={t.reports.legend.github}
            stackId="m"
            fill={colors.gray}
            radius={[3, 3, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function AvgConfidenceChart({ points }: { points: DailyConfidencePoint[] }) {
  const colors = useChartColors();
  const data = points.map((p) => ({ date: shortDate(p.date), avg: p.avg }));
  // null 인 일자가 있어도 connectNulls=false 로 자연스러운 gap.
  return (
    <div className={styles.chartWrap}>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={colors.grid} vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="date" stroke={colors.axis} fontSize={11} tickLine={false} />
          <YAxis stroke={colors.axis} fontSize={11} tickLine={false} domain={[0, 100]} width={28} />
          <Tooltip cursor={{ stroke: colors.grid }} content={<ChartTooltip />} />
          <Line
            type="monotone"
            dataKey="avg"
            name={t.reports.section.avgConfidence}
            stroke={colors.blue}
            strokeWidth={2}
            dot={{ r: 3, fill: colors.blue, strokeWidth: 0 }}
            activeDot={{ r: 5 }}
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
