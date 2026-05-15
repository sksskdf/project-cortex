import type {
  AgentKind,
  CurrentUser,
  GaugeTier,
  ReasonTone,
  SidebarCounts,
  StatDelta,
  TagTone,
} from '@/lib/types';

export type { GaugeTier, TagTone };

export const currentUser: CurrentUser = {
  name: '정현',
  role: '엔지니어링 리드',
  initials: 'JH',
};

export const sidebarCounts: SidebarCounts = {
  inbox: 8,
  projects: 12,
  agents: 7,
  clusters: 2,
};

export const favoriteProjects: ReadonlyArray<string> = ['cortex-web', 'payments-api'];

export type DashboardStats = {
  pendingReview: { value: number; delta: StatDelta };
  autoMergedThisWeek: { value: number; delta: StatDelta };
  agentsRunning: { value: number };
  avgConfidence: { value: number; delta: StatDelta };
};

export const dashboardStats: DashboardStats = {
  pendingReview: {
    value: 8,
    delta: { amount: 3, direction: 'up', comparedTo: '어제 대비' },
  },
  autoMergedThisWeek: {
    value: 47,
    delta: { amount: 12, direction: 'up', comparedTo: '지난주 대비' },
  },
  agentsRunning: {
    value: 12,
  },
  avgConfidence: {
    value: 87,
    delta: { amount: 2, direction: 'up', comparedTo: '지난주 대비' },
  },
};

export type TodoRow = {
  id: string;
  title: string;
  agent: { name: string; kind: AgentKind };
  tags: ReadonlyArray<{ label: string; tone: TagTone }>;
  reason: { text: string; tone: ReasonTone };
  additions: number;
  deletions: number;
  ageText: string;
  gauge: { value: number; tier: GaugeTier };
};

export const todoRows: ReadonlyArray<TodoRow> = [
  {
    id: 'pr-101',
    title: '결제 모듈 — 환불 정책 변경',
    agent: { name: 'Devin', kind: 'agent' },
    tags: [
      { label: '결제 모듈', tone: 'red' },
      { label: '테스트 부족', tone: 'yellow' },
    ],
    reason: { text: '결제 영역 변경 + 테스트 커버리지 58%로 기준 미달', tone: 'alert' },
    additions: 286,
    deletions: 47,
    ageText: '12분 전',
    gauge: { value: 46, tier: 'error' },
  },
  {
    id: 'pr-102',
    title: '데이터베이스 — users 테이블 인덱스 추가',
    agent: { name: 'Codex', kind: 'agent' },
    tags: [{ label: '마이그레이션', tone: 'red' }],
    reason: { text: '프로덕션 마이그레이션 — 사람 승인 필수', tone: 'alert' },
    additions: 34,
    deletions: 0,
    ageText: '38분 전',
    gauge: { value: 63, tier: 'warning' },
  },
  {
    id: 'pr-103',
    title: '알림 — Slack webhook 연동 추가',
    agent: { name: 'Devin', kind: 'agent' },
    tags: [{ label: '외부 API', tone: 'purple' }],
    reason: { text: '신규 외부 호출 — 보안 검토 권장', tone: 'info' },
    additions: 128,
    deletions: 12,
    ageText: '1시간 전',
    gauge: { value: 76, tier: 'blue' },
  },
];

export type ActivityFeedItem = {
  id: string;
  agent: string;
  title: string;
  score: number;
  ageText: string;
  repo: string;
};

export const recentAutoMerges: ReadonlyArray<ActivityFeedItem> = [
  {
    id: 'fa-1',
    agent: 'Devin',
    title: 'i18n 라벨 12개 추가',
    score: 94,
    ageText: '3분 전',
    repo: 'cortex-web',
  },
  {
    id: 'fa-2',
    agent: 'Codex',
    title: '유닛 테스트 보강',
    score: 91,
    ageText: '14분 전',
    repo: 'payments-api',
  },
  {
    id: 'fa-3',
    agent: 'Devin',
    title: '타입 정의 정리',
    score: 96,
    ageText: '42분 전',
    repo: 'cortex-web',
  },
  {
    id: 'fa-4',
    agent: '내부 에이전트',
    title: '의존성 패치 업데이트',
    score: 89,
    ageText: '1시간 전',
    repo: '5개 레포',
  },
  {
    id: 'fa-5',
    agent: 'Codex',
    title: 'README 오타 수정',
    score: 99,
    ageText: '2시간 전',
    repo: 'cortex-web',
  },
];

export type WorkloadBarTone = 'blue' | 'green' | 'yellow';

export type AgentWorkload = {
  name: string;
  current: number;
  capacity: number;
  bar: WorkloadBarTone;
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

export type ClusterSummary = {
  id: string;
  title: string;
  count: number;
  avgScore: number;
  note: string;
};

export const dashboardClusters: ReadonlyArray<ClusterSummary> = [
  {
    id: 'cluster-1',
    title: 'i18n 라벨 패턴',
    count: 5,
    avgScore: 91,
    note: '평균 신뢰 91 · 한 번의 결정으로 처리 가능',
  },
  {
    id: 'cluster-2',
    title: '의존성 마이너 업데이트',
    count: 3,
    avgScore: 88,
    note: '평균 신뢰 88 · lock 파일 변경 포함',
  },
];

export const todayReviewCount = 8;
export const weekAutoMergedCount = 47;
