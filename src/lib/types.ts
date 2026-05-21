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

// 인박스 행 / 대시보드 todo 행에서 인라인 액션 버튼 (머지·PR 닫기·브랜치 삭제) 활성화
// 여부 결정용. PRRowActions 컴포넌트가 이 정보로 어느 버튼을 노출할지 결정.
// installation/branchDeleted 등을 직접 보내지 않고 derived 결과만.
export type PRRowActionState = {
  // 머지 버튼 활성 가능 — installation 있음 + 머지/닫힘 아님 + CI 통과/대기 무관.
  // (CI 대기 시 PR 상세에서는 disable 하지만 인박스 행에선 단순화 — 클릭 시 결과 처리).
  canMerge: boolean;
  // PR 닫기 버튼 활성 가능 — installation 있음 + 머지/닫힘 아님.
  canClose: boolean;
  // 머지된 PR 의 head 브랜치 삭제 가능 — status='merged' + branchDeletedAt null + installation.
  canDeleteBranch: boolean;
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
