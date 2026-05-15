import { sql } from 'drizzle-orm';
import { integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const now = sql`(unixepoch())`;

export const projects = sqliteTable('projects', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  defaultBranch: text('default_branch').notNull().default('main'),
  autoMergeEnabled: integer('auto_merge_enabled', { mode: 'boolean' }).notNull().default(false),
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

export type ProjectRow = typeof projects.$inferSelect;
export type IssueRow = typeof issues.$inferSelect;
export type AgentRunRow = typeof agentRuns.$inferSelect;
export type PRRecord = typeof prs.$inferSelect;
export type PreReviewRow = typeof preReviews.$inferSelect;
export type TriageDecisionRow = typeof triageDecisions.$inferSelect;
export type ClusterRow = typeof clusters.$inferSelect;
