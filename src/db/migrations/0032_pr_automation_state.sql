ALTER TABLE `prs` ADD `test_fix_attempts` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `prs` ADD `review_fix_attempts` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `prs` ADD `automation_in_flight` text;
