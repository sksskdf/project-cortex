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
  // 머지 버튼 활성 가능 — installation 있음 + 머지/닫힘 아님. 머지 성공 시 브랜치 자동 삭제.
  canMerge: boolean;
  // PR 닫기 버튼 활성 가능 — installation 있음 + 머지/닫힘 아님.
  canClose: boolean;
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
  gauge: PRGauge;
  // 인박스 / 대시보드 행에서 인라인 액션 노출. 없으면 (e.g. fixture 데이터) 액션 없음.
  actions?: PRRowActionState;
};

export type SidebarCounts = {
  inbox: number;
  projects: number;
  agents: number;
  clusters: number;
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
