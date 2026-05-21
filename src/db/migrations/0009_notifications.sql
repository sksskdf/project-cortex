CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`pr_id` integer,
	`cluster_id` integer,
	`project_id` integer,
	`title` text NOT NULL,
	`body` text,
	`read_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`pr_id`) REFERENCES `prs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cluster_id`) REFERENCES `clusters`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `notifications_unread_idx` ON `notifications` (`read_at`,`created_at` DESC);
--> statement-breakpoint
CREATE INDEX `notifications_created_idx` ON `notifications` (`created_at` DESC);
