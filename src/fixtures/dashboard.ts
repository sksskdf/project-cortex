// 운영 메트릭(Phase 7)에서 DB로 옮겨질 임시 fixture.
// 실 데이터 흐름이 들어오기 전까지 비어있는 상태를 유지 — 가짜 숫자로 사용자를 헷갈리게 하지 않음.

export type AgentWorkload = {
  name: string;
  current: number;
  capacity: number;
  bar: 'blue' | 'green' | 'yellow';
  eta: string;
};

// Phase 8 (intake) 에서 agent_runs 와 매칭되는 워크로드 집계로 대체.
// 그전까지 빈 배열 → 대시보드가 "준비 중" 빈 상태 카드를 렌더.
export const agentWorkloads: ReadonlyArray<AgentWorkload> = [];

// 클러스터 노트는 Phase 6 clustering 분석에서 자동 생성될 예정.
export const clusterNotes: Record<string, string> = {
  'i18n-labels': '평균 신뢰 91 · 한 번의 결정으로 처리 가능',
};
