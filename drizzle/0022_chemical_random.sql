CREATE TABLE `ad_markers` (
	`id` text PRIMARY KEY NOT NULL,
	`episode_id` text NOT NULL,
	`start_time` real NOT NULL,
	`position` text DEFAULT 'mid' NOT NULL,
	`description` text,
	`duration` real,
	`campaign_id` text,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `chapters` (
	`id` text PRIMARY KEY NOT NULL,
	`episode_id` text NOT NULL,
	`start_time` real NOT NULL,
	`end_time` real,
	`title` text NOT NULL,
	`url` text,
	`image` text,
	`toc` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE cascade
);
