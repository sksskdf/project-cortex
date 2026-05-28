CREATE TABLE `github_apps` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`app_id` text NOT NULL,
	`private_key` text NOT NULL,
	`webhook_secret` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `github_apps_name_idx` ON `github_apps` (`name`);
--> statement-breakpoint
ALTER TABLE `projects` ADD `app_config_id` integer REFERENCES github_apps(id);
