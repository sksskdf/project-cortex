import type { StatDelta } from '@/lib/types';

// 운영 메트릭(Phase 7)에서 DB로 옮겨질 임시 fixture.
// 현재는 mock-equivalent 시각 출력 유지용.

export type AgentWorkload = {
  name: string;
  current: number;
  capacity: number;
  bar: 'blue' | 'green' | 'yellow';
  eta: string;
};

export const agentWorkloads: ReadonlyArray<AgentWorkload> = [
  {
    name: 'Devin',
    current: 5,
    capacity: 8,
    bar: 'blue',
    eta: '평균 ETA 28분 · 4분 후 첫 작업 완료',
  },
  {
    name: 'Codex',
    current: 4,
    capacity: 6,
    bar: 'green',
    eta: '평균 ETA 12분 · 2분 후 첫 작업 완료',
  },
  {
    name: '내부 에이전트',
    current: 3,
    capacity: 4,
    bar: 'yellow',
    eta: '평균 ETA 46분 · 큐 대기 1건',
  },
];

// 통계 비교 delta — Phase 7에서 시계열 메트릭으로 대체.
export const statDeltas: {
  pendingReview: StatDelta;
  autoMerged: StatDelta;
  avgConfidence: StatDelta;
} = {
  pendingReview: { amount: 3, direction: 'up', comparedTo: '어제 대비' },
  autoMerged: { amount: 12, direction: 'up', comparedTo: '지난주 대비' },
  avgConfidence: { amount: 2, direction: 'up', comparedTo: '지난주 대비' },
};

// 클러스터 노트는 Phase 6 clustering 분석에서 자동 생성될 예정.
export const clusterNotes: Record<string, string> = {
  'i18n-labels': '평균 신뢰 91 · 한 번의 결정으로 처리 가능',
};

// 진행 중 에이전트 카운트 — agent_runs 시드 전까지 고정값.
export const agentsRunningCount = 12;
