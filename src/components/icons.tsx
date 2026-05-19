// 여러 화면에서 반복되는 아이콘을 한 곳에 모은다.
// 단일 사용처에만 쓰이는 아이콘(예: dashboard 의 boltIcon)은 호출 파일에 둠.
// stroke 굵기·크기가 호출처마다 달라지는 경우 props 로 받음.

import type { ReactNode, SVGProps } from 'react';

type IconSize = number | string;

type IconProps = {
  strokeWidth?: number;
  size?: IconSize;
  className?: string;
};

function svgBase({
  strokeWidth = 2,
  size,
  className,
  fill = 'none',
  children,
}: IconProps & { fill?: string; children: ReactNode }): ReactNode {
  const props: SVGProps<SVGSVGElement> = {
    viewBox: '0 0 24 24',
    fill,
    stroke: 'currentColor',
    strokeWidth,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    className,
  };
  if (size !== undefined) {
    props.width = size;
    props.height = size;
  }
  return <svg {...props}>{children}</svg>;
}

export function CheckIcon(props: IconProps = {}) {
  return svgBase({
    ...props,
    strokeWidth: props.strokeWidth ?? 3,
    children: <polyline points="20 6 9 17 4 12" />,
  });
}

export function AlertIcon(props: IconProps = {}) {
  return svgBase({
    ...props,
    strokeWidth: props.strokeWidth ?? 2.5,
    children: (
      <>
        <circle cx={12} cy={12} r={10} />
        <line x1={12} y1={8} x2={12} y2={12} />
        <line x1={12} y1={16} x2={12.01} y2={16} />
      </>
    ),
  });
}

export function InfoIcon(props: IconProps = {}) {
  return svgBase({
    ...props,
    strokeWidth: props.strokeWidth ?? 2.5,
    children: (
      <>
        <circle cx={12} cy={12} r={10} />
        <line x1={12} y1={16} x2={12} y2={12} />
        <line x1={12} y1={8} x2={12.01} y2={8} />
      </>
    ),
  });
}

// AlertIcon 과 비슷하지만 더 두꺼움 — 파일 상태 등 강조용.
export function WarnIcon(props: IconProps = {}) {
  return svgBase({
    ...props,
    strokeWidth: props.strokeWidth ?? 3,
    children: (
      <>
        <line x1={12} y1={8} x2={12} y2={12} />
        <line x1={12} y1={16} x2={12.01} y2={16} />
      </>
    ),
  });
}

export function HelpIcon(props: IconProps = {}) {
  return svgBase({
    ...props,
    strokeWidth: props.strokeWidth ?? 2,
    children: (
      <>
        <circle cx={12} cy={12} r={10} />
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
        <line x1={12} y1={17} x2={12.01} y2={17} />
      </>
    ),
  });
}

export function BellIcon(props: IconProps = {}) {
  return svgBase({
    ...props,
    children: (
      <>
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </>
    ),
  });
}

export function ChevronLeftIcon(props: IconProps = {}) {
  return svgBase({
    ...props,
    children: <polyline points="15 18 9 12 15 6" />,
  });
}

export function ChevronRightIcon(props: IconProps = {}) {
  return svgBase({
    ...props,
    children: <polyline points="9 18 15 12 9 6" />,
  });
}

export function ClusterIcon(props: IconProps = {}) {
  return svgBase({
    ...props,
    children: (
      <>
        <circle cx={6} cy={6} r={3} />
        <circle cx={18} cy={6} r={3} />
        <circle cx={12} cy={18} r={3} />
        <path d="M9 8l3 8m3-8l-3 8" />
      </>
    ),
  });
}

export function AgentFaceIcon(props: IconProps = {}) {
  return svgBase({
    ...props,
    children: (
      <>
        <rect x={4} y={4} width={16} height={16} rx={2} />
        <circle cx={9} cy={10} r={1.5} fill="currentColor" />
        <circle cx={15} cy={10} r={1.5} fill="currentColor" />
        <path d="M9 15h6" />
      </>
    ),
  });
}

export function HumanFaceIcon(props: IconProps = {}) {
  return svgBase({
    ...props,
    children: (
      <>
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx={12} cy={7} r={4} />
      </>
    ),
  });
}
