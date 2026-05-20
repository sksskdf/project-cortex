CREATE TABLE `app_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`ai_enabled` integer DEFAULT true NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
