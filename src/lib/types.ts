export type AgentKind = 'agent' | 'human';

export type ConfidenceTier = 'high' | 'medium' | 'low' | 'critical';

export type GaugeTier = 'error' | 'warning' | 'blue' | 'success';

export type TagTone = 'red' | 'yellow' | 'purple' | 'green' | 'gray' | 'sky-blue' | 'cyan';

export type ReasonTone = 'alert' | 'warn' | 'info';

export type RiskFlag =
  | 'payment-domain'
  | 'auth-domain'
  | 'migration'
  | 'security-sensitive'
  | 'external-api-new'
  | 'low-coverage'
  | 'large-change';

export type PRAuthor = {
  name: string;
  kind: AgentKind;
};

export type PRTag = {
  label: string;
  tone: TagTone;
};

export type PRReason = {
  text: string;
  tone: ReasonTone;
};

export type PRGauge = {
  value: number;
  tier: GaugeTier;
};

// 인박스 행 / 대시보드 todo 행에서 인라인 액션 버튼 활성화 여부.
// 머지 시 브랜치 자동 삭제이므로 별도 '브랜치 삭제' 액션 없음.
export type PRRowActionState = {
  // 머지 버튼 활성 가능 — installation 있음 + 머지/닫힘 아님 + CI 통과 (또는 CI 없는 레포).
  // 머지 성공 시 브랜치 자동 삭제.
  canMerge: boolean;
  // PR 닫기 버튼 활성 가능 — installation 있음 + 머지/닫힘 아님.
  canClose: boolean;
  // CI 결과 대기 중이라 머지가 막혔는지 — disabled 사유 노출용. canMerge=false 의 부분 집합.
  mergeBlockedByCI?: boolean;
  // 머지 불가 사유 문구 (충돌/차단/CI 실패·대기). null 이면 막힌 사유 없음(또는 머지 가능).
  // PR 상세처럼 행에서도 disabled 버튼 옆에 노출.
  mergeBlockReason?: string | null;
};

export type PR = {
  id: string;
  title: string;
  repo?: string;
  number?: number;
  author: PRAuthor;
  tags: ReadonlyArray<PRTag>;
  reason: PRReason;
  additions: number;
  deletions: number;
  fileCount?: number;
  ageText: string;
  // 정렬용 활동 시각(epoch ms) — ageText 는 사람용 문자열이라 파싱 정렬이 부정확("방금"·"1개월"
  // 등에서 0 으로 붕괴)했다. 인박스 빌더가 실제 timestamp 를 넣어 orderInbox 가 이 값으로 정렬.
  // 미지정(fixture 등)이면 orderInbox 가 ageText 파싱으로 폴백.
  activityMs?: number;
  gauge: PRGauge;
  // 인박스 / 대시보드 행에서 인라인 액션 노출. 없으면 (e.g. fixture 데이터) 액션 없음.
  actions?: PRRowActionState;
  // 진행 중인 claude 자동화 (충돌해결·테스트수정·리뷰반영). 인메모리(automation-state) 라이브.
  // null/미지정이면 표시 안 함.
  automation?: import('@/lib/automation-state').AutomationKind | null;
};

export type SidebarCounts = {
  inbox: number;
  projects: number;
  issues: number;
  agents: number;
  clusters: number;
  todos: number;
  notes: number;
};

export type StatDelta = {
  amount: number;
  direction: 'up' | 'down' | 'flat';
  comparedTo: string;
};

export type CurrentUser = {
  name: string;
  role: string;
  initials: string;
  // GitHub 로그인 — 인박스의 '나에게 멘션' 카테고리가 PR body / review 본문에
  // `@<githubLogin>` 매칭에 사용.
  githubLogin: string;
};

export type FileStatus = 'ok' | 'warn' | 'alert';

export type CodeLineKind = 'ctx' | 'add' | 'del' | 'hunk-head';

export type CodeLine = {
  lineNumber: number | null;
  text: string;
  kind: CodeLineKind;
};

export type Hunk =
  | {
      kind: 'collapsed';
      id: string;
      summary: string;
      summaryHighlight: string;
      lineCount: number;
    }
  | {
      kind: 'expanded';
      id: string;
      reason: PRReason;
      lines: ReadonlyArray<CodeLine>;
      aiComment?: string;
    };

export type FileBlock = {
  path: string;
  status: FileStatus;
  additions: number;
  deletions: number;
  hunks: ReadonlyArray<Hunk>;
};
