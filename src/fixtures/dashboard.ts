// agentWorkloads/AgentWorkload (빈 fixture 였음) 은 제거됨 — `dashboard.getAgentWorkloads()`
// 가 실 agent_runs 에서 직접 집계한다.

// 자동 클러스터링이 만들던 패턴별 노트 — 자동 클러스터링이 중단된 후로는 채워지지 않으나,
// 기존 패턴키('i18n-labels' 등)가 있는 클러스터 카드 텍스트가 빈 채로 노출되지 않도록 보존.
export const clusterNotes: Record<string, string> = {
  'i18n-labels': '평균 신뢰 91 · 한 번의 결정으로 처리 가능',
};
