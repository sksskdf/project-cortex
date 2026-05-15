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
