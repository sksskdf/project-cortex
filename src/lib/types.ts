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
  todos: number;
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
