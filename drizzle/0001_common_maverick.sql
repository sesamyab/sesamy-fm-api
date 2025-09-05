CREATE TABLE `image_uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`show_id` text,
	`episode_id` text,
	`file_name` text NOT NULL,
	`file_size` integer NOT NULL,
	`mime_type` text NOT NULL,
	`url` text NOT NULL,
	`uploaded_at` text NOT NULL,
	FOREIGN KEY (`show_id`) REFERENCES `shows`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `episodes` ADD `image_url` text;