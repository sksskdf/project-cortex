CREATE TABLE `roadmap_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`phase_id` integer NOT NULL,
	`title` text NOT NULL,
	`note` text,
	`status` text DEFAULT 'planned' NOT NULL,
	`done_by_pr_id` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`phase_id`) REFERENCES `roadmap_phases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`done_by_pr_id`) REFERENCES `prs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `roadmap_phases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`key` text NOT NULL,
	`title` text NOT NULL,
	`goal` text,
	`status` text DEFAULT 'planned' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `roadmap_phases_project_key_idx` ON `roadmap_phases` (`project_id`,`key`);