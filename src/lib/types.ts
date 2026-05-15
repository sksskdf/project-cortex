export type AgentKind = 'agent' | 'human';

export type ConfidenceTier = 'high' | 'medium' | 'low' | 'critical';

export type RiskFlag =
  | 'payment-domain'
  | 'auth-domain'
  | 'migration'
  | 'security-sensitive'
  | 'external-api-new'
  | 'low-coverage'
  | 'large-change';

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
