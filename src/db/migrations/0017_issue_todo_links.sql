ALTER TABLE `issues` ADD `roadmap_item_id` integer REFERENCES roadmap_items(id);--> statement-breakpoint
ALTER TABLE `todos` ADD `issue_id` integer REFERENCES issues(id);