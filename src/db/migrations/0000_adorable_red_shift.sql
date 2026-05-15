CREATE TABLE `agent_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`issue_id` integer NOT NULL,
	`agent` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`input` text,
	`log` text,
	`tool_calls` text,
	`output_pr_id` integer,
	`started_at` integer,
	`completed_at` integer,
	`eta_sec` integer,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`output_pr_id`) REFERENCES `prs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `clusters` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`pattern` text NOT NULL,
	`title` text NOT NULL,
	`common_diff_snippet` text,
	`avg_confidence` integer NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`closed_at` integer
);
--> statement-breakpoint
CREATE TABLE `issues` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`repo_id` integer NOT NULL,
	`title` text NOT NULL,
	`spec` text NOT NULL,
	`assignee_kind` text NOT NULL,
	`assignee_id` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`repo_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `pre_reviews` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`pr_id` integer NOT NULL,
	`head_sha` text NOT NULL,
	`confidence` integer NOT NULL,
	`confidence_tier` text NOT NULL,
	`flags` text NOT NULL,
	`hunk_annotations` text,
	`summary` text,
	`comments` text,
	`tests_passed` integer,
	`coverage` real,
	`analyzed_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`pr_id`) REFERENCES `prs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pre_reviews_pr_sha_idx` ON `pre_reviews` (`pr_id`,`head_sha`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`default_branch` text DEFAULT 'main' NOT NULL,
	`auto_merge_enabled` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_slug_unique` ON `projects` (`slug`);--> statement-breakpoint
CREATE TABLE `prs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`repo_id` integer NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`author_kind` text NOT NULL,
	`author_id` text NOT NULL,
	`head_sha` text NOT NULL,
	`lines_added` integer NOT NULL,
	`lines_removed` integer NOT NULL,
	`files_changed` integer NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`cluster_id` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`repo_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cluster_id`) REFERENCES `clusters`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `triage_decisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`pr_id` integer NOT NULL,
	`decision` text NOT NULL,
	`reason` text NOT NULL,
	`cluster_id` integer,
	`decided_by` text NOT NULL,
	`decided_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`pr_id`) REFERENCES `prs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cluster_id`) REFERENCES `clusters`(`id`) ON UPDATE no action ON DELETE no action
);
