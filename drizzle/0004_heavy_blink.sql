ALTER TABLE `tasks` ADD `started_at` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `progress` integer DEFAULT 0;