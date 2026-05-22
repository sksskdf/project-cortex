import { sql } from 'drizzle-orm';
import { integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { FileBlock } from '@/lib/types';

const now = sql`(unixepoch())`;

export const projects = sqliteTable('projects', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  defaultBranch: text('default_branch').notNull().default('main'),
  autoMergeEnabled: integer('auto_merge_enabled', { mode: 'boolean' }).notNull().default(false),
  // GitHub App installation id — App 가 이 레포에 설치될 때 GitHub 가 발급.
  // null 이면 시드/데모 프로젝트 (실 webhook 흐름 비대상).
  // Phase 3.4b 의 credentials 테이블이 들어오면 FK 로 분리됨.
  installationId: integer('installation_id'),
  // Phase 10.1 — .cortex/project.yml 에서 가져온 메타. null 이면 sync 안 됨 (manual).
  description: text('description'),
  kind: text('kind'), // web-app | cli | library | mobile | docs | infra (자유 텍스트)
  domain: text('domain'),
  homepage: text('homepage'),
  metaSyncedAt: integer('meta_synced_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now),
});

export const issues = sqliteTable('issues', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  repoId: integer('repo_id')
    .notNull()
    .references(() => projects.id),
  title: text('title').notNull(),
  spec: text('spec').notNull(),
  assigneeKind: text('assignee_kind', { enum: ['human', 'agent'] }).notNull(),
  assigneeId: text('assignee_id').notNull(),
  status: text('status', { enum: ['open', 'in-progress', 'done', 'closed'] })
    .notNull()
    .default('open'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(now),
});

export const clusters = sqliteTable('clusters', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  pattern: text('pattern').notNull(),
  title: text('title').notNull(),
  commonDiffSnippet: text('common_diff_snippet'),
  avgConfidence: integer('avg_confidence').notNull(),
  status: text('status', {
    enum: ['open', 'partially-merged', 'merged', 'dissolved'],
  })
    .notNull()
    .default('open'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now),
  closedAt: integer('closed_at', { mode: 'timestamp' }),
});

export const prs = sqliteTable('prs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  repoId: integer('repo_id')
    .notNull()
    .references(() => projects.id),
  number: integer('number').notNull(),
  title: text('title').notNull(),
  // GitHub PR body (description). 빈 PR 도 있어 nullable.
  body: text('body'),
  authorKind: text('author_kind', { enum: ['agent', 'human'] }).notNull(),
  authorId: text('author_id').notNull(),
  headSha: text('head_sha').notNull(),
  linesAdded: integer('lines_added').notNull(),
  linesRemoved: integer('lines_removed').notNull(),
  filesChanged: integer('files_changed').notNull(),
  status: text('status', {
    enum: ['open', 'review-needed', 'auto-mergeable', 'merged', 'closed'],
  })
    .notNull()
    .default('open'),
  clusterId: integer('cluster_id').references(() => clusters.id),
  // head 브랜치가 머지 후 삭제된 시점. null 이면 미삭제. PR 상세의 '브랜치 삭제'
  // 버튼이 두 번째 진입 시에도 비활성화될 수 있도록 영속 기록.
  branchDeletedAt: integer('branch_deleted_at', { mode: 'timestamp' }),
  // 마지막으로 클러스터에서 해체된 시점. null 이면 한 번도 해체된 적 없음.
  // tryClusterPR 가 cooldown 기간 안에 있는 PR 은 자동 클러스터링에서 제외 — 사용자가
  // 의도적으로 해체한 PR 이 곧바로 다시 묶이지 않게.
  clusterDissolvedAt: integer('cluster_dissolved_at', { mode: 'timestamp' }),
  // GitHub CI 결과 (Check Runs API 집계). null 이면 미수신/CI 미설정 — AI 분석 여부와
  // 무관 (preReview 없어도 채워질 수 있게 PR 에 직접 묶음). handleCheckWebhook 가
  // check_run/check_suite completed 시점에 갱신.
  testsPassed: integer('tests_passed', { mode: 'boolean' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(now),
});

export const agentRuns = sqliteTable('agent_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  issueId: integer('issue_id')
    .notNull()
    .references(() => issues.id),
  agent: text('agent').notNull(),
  status: text('status', { enum: ['queued', 'running', 'completed', 'failed'] })
    .notNull()
    .default('queued'),
  input: text('input', { mode: 'json' }),
  log: text('log'),
  toolCalls: text('tool_calls', { mode: 'json' }),
  outputPrId: integer('output_pr_id').references(() => prs.id),
  startedAt: integer('started_at', { mode: 'timestamp' }),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
  etaSec: integer('eta_sec'),
});

export type PreReviewComment = {
  path: string;
  line: number;
  body: string;
};

export type PreReviewHunkAnnotation = {
  hunkId: string;
  decision: 'auto' | 'review';
  reason?: string;
};

export const preReviews = sqliteTable(
  'pre_reviews',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    prId: integer('pr_id')
      .notNull()
      .references(() => prs.id),
    headSha: text('head_sha').notNull(),
    confidence: integer('confidence').notNull(),
    confidenceTier: text('confidence_tier', {
      enum: ['critical', 'low', 'medium', 'high'],
    }).notNull(),
    flags: text('flags', { mode: 'json' }).$type<string[]>().notNull(),
    // 클러스터링 유사도 계산용 — analyzePR 이 diff 에서 추출해 저장.
    changedPaths: text('changed_paths', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    // PR 상세 화면이 실 hunk 를 렌더하도록 파싱된 diff 를 캐시.
    // analyzePR 이 getPRDiff 결과를 parseUnifiedDiff 로 변환해 저장. 빈 배열이면 분석 안 됨.
    parsedFiles: text('parsed_files', { mode: 'json' })
      .$type<FileBlock[]>()
      .notNull()
      .default(sql`'[]'`),
    hunkAnnotations: text('hunk_annotations', { mode: 'json' }).$type<PreReviewHunkAnnotation[]>(),
    summary: text('summary'),
    comments: text('comments', { mode: 'json' }).$type<PreReviewComment[]>(),
    testsPassed: integer('tests_passed', { mode: 'boolean' }),
    coverage: real('coverage'),
    analyzedAt: integer('analyzed_at', { mode: 'timestamp' }).notNull().default(now),
  },
  (table) => ({
    prShaIdx: uniqueIndex('pre_reviews_pr_sha_idx').on(table.prId, table.headSha),
  }),
);

export const triageDecisions = sqliteTable('triage_decisions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  prId: integer('pr_id')
    .notNull()
    .references(() => prs.id),
  decision: text('decision', {
    enum: ['auto-merge', 'human-review', 'cluster'],
  }).notNull(),
  reason: text('reason').notNull(),
  clusterId: integer('cluster_id').references(() => clusters.id),
  decidedBy: text('decided_by', { enum: ['system', 'human'] }).notNull(),
  decidedAt: integer('decided_at', { mode: 'timestamp' }).notNull().default(now),
});

// 전역 단일 row 설정. id=1 강제. 새 설정은 컬럼 추가로 확장.
// 운영 토글 (예: AI 분석 on/off) 을 UI 에서 즉시 반영하기 위함.
export const appSettings = sqliteTable('app_settings', {
  id: integer('id').primaryKey(),
  // false 면 analyzePR · tryClusterPR · 자동 머지가 모두 skip — Anthropic 호출 0.
  aiEnabled: integer('ai_enabled', { mode: 'boolean' }).notNull().default(true),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(now),
});

// 헤더 알림 드롭다운에 노출되는 이벤트 로그. 자동 머지 성공·실패, CI 실패, 새 클러스터,
// revert 감지 등 사용자가 즉시 알아야 하는 이벤트만 row 로 적재. 만성적 상태 (인박스 카운트
// 등) 는 별개 — 인박스는 prs.status 로 직접 집계.
export const notifications = sqliteTable('notifications', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  kind: text('kind', {
    enum: ['auto-merged', 'auto-merge-failed', 'ci-failed', 'cluster-created', 'revert-detected'],
  }).notNull(),
  // 관련 객체 — 클릭 시 이동할 라우트를 라이브러리에서 도출. 모두 nullable.
  prId: integer('pr_id').references(() => prs.id),
  clusterId: integer('cluster_id').references(() => clusters.id),
  projectId: integer('project_id').references(() => projects.id),
  title: text('title').notNull(),
  body: text('body'),
  // null 이면 unread. 사용자가 드롭다운 열거나 명시 클릭 시 채워짐.
  readAt: integer('read_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now),
});

// Phase 10 — 프로젝트별 로드맵. projects 의 Phase 들과 그 안의 산출물 (item).
// docs/ROADMAP.md 같은 마크다운 문서를 Cortex 안에서 구조화된 데이터로 관리.
// PR 머지 시 본문의 'Closes #PHASE-N' 같은 컨벤션을 매칭해 자동으로 item.status='done' 전환.
export const roadmapPhases = sqliteTable(
  'roadmap_phases',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id),
    // 사람이 정한 짧은 식별자 — PR 본문 'Closes #PHASE-3' 형식에서 매칭됨.
    // '3', 'auth', 'launch' 등 자유 텍스트. (project_id, key) unique.
    key: text('key').notNull(),
    title: text('title').notNull(),
    goal: text('goal'),
    status: text('status', { enum: ['planned', 'in-progress', 'done'] })
      .notNull()
      .default('planned'),
    // 같은 프로젝트 안에서 카드 정렬용. 작은 숫자가 위.
    sortOrder: integer('sort_order').notNull().default(0),
    // Phase 10.1 — 데이터 origin. 'git' = .cortex/roadmap.md 에서 가져옴 (sync 가 덮어쓸 수 있음).
    // 'manual' = 사용자가 Cortex UI 에서 추가. sync 가 안 건드림.
    source: text('source', { enum: ['git', 'manual'] })
      .notNull()
      .default('manual'),
    // 사용자가 git source 항목을 UI 에서 수정한 시점. null 이면 미수정.
    // 다음 sync 시 이 값이 채워진 행은 덮어쓰지 않고 충돌 배지로 표시.
    sourceOverrideAt: integer('source_override_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(now),
  },
  (table) => ({
    projectKeyIdx: uniqueIndex('roadmap_phases_project_key_idx').on(table.projectId, table.key),
  }),
);

export const roadmapItems = sqliteTable('roadmap_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  phaseId: integer('phase_id')
    .notNull()
    .references(() => roadmapPhases.id),
  title: text('title').notNull(),
  // 완료 사유나 PR 링크 — done 일 때 자동 채워질 수 있음.
  note: text('note'),
  status: text('status', { enum: ['planned', 'in-progress', 'done'] })
    .notNull()
    .default('planned'),
  // 머지 시 자동 done 으로 전환시킨 PR. null 이면 수동 toggle.
  doneByPrId: integer('done_by_pr_id').references(() => prs.id),
  sortOrder: integer('sort_order').notNull().default(0),
  // Phase 10.1 — Phase 와 동일.
  source: text('source', { enum: ['git', 'manual'] })
    .notNull()
    .default('manual'),
  sourceOverrideAt: integer('source_override_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(now),
});

// Phase 11 — 개인 생산성 TODO. 한 줄 작업, 우선순위, due date, 연결된 PR/프로젝트
// (optional FK). 로드맵 item 과 별개 — 로드맵은 "산출물" (배포 단위), todo 는 데일리 작업.
export const todos = sqliteTable('todos', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  note: text('note'),
  status: text('status', { enum: ['open', 'in-progress', 'done'] })
    .notNull()
    .default('open'),
  priority: text('priority', { enum: ['low', 'normal', 'high'] })
    .notNull()
    .default('normal'),
  // 마감 (옵션). null 이면 일정 X — 단순 backlog.
  dueAt: integer('due_at', { mode: 'timestamp' }),
  // 관련 PR / 프로젝트 (옵션). 클릭 시 이동.
  projectId: integer('project_id').references(() => projects.id),
  prId: integer('pr_id').references(() => prs.id),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(now),
});

// Phase 12 — 로컬 워크스페이스 등록. projects 의 로컬 클론 경로. git pull 등 자동화의
// 작업 디렉토리 + Phase 13 (Claude CLI) 의 spawn 경로 화이트리스트.
export const workspaces = sqliteTable('workspaces', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id')
    .notNull()
    .references(() => projects.id),
  // 절대 경로 (예: 'C:\\dev\\projects\\foo' 또는 '/home/user/foo').
  // 한 프로젝트당 1개 — 추가 등록 시 기존 행 갱신.
  localPath: text('local_path').notNull(),
  // 마지막 git pull 시각 + 결과 — UI 가 stale 여부 표시.
  lastPullAt: integer('last_pull_at', { mode: 'timestamp' }),
  lastPullResult: text('last_pull_result'), // 짧은 메시지 (성공 N commits / 실패 사유)
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(now),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(now),
});

export type ProjectRow = typeof projects.$inferSelect;
export type IssueRow = typeof issues.$inferSelect;
export type AgentRunRow = typeof agentRuns.$inferSelect;
export type PRRecord = typeof prs.$inferSelect;
export type PreReviewRow = typeof preReviews.$inferSelect;
export type TriageDecisionRow = typeof triageDecisions.$inferSelect;
export type ClusterRow = typeof clusters.$inferSelect;
export type AppSettingsRow = typeof appSettings.$inferSelect;
export type NotificationRow = typeof notifications.$inferSelect;
export type RoadmapPhaseRow = typeof roadmapPhases.$inferSelect;
export type RoadmapItemRow = typeof roadmapItems.$inferSelect;
export type TodoRow = typeof todos.$inferSelect;
export type WorkspaceRow = typeof workspaces.$inferSelect;
