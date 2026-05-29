CREATE INDEX IF NOT EXISTS `prs_repo_status_idx` ON `prs` (`repo_id`,`status`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `projects_installation_idx` ON `projects` (`installation_id`);
