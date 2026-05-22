ALTER TABLE `projects` ADD `description` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `kind` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `domain` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `homepage` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `meta_synced_at` integer;--> statement-breakpoint
ALTER TABLE `roadmap_items` ADD `source` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `roadmap_items` ADD `source_override_at` integer;--> statement-breakpoint
ALTER TABLE `roadmap_phases` ADD `source` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `roadmap_phases` ADD `source_override_at` integer;