CREATE TABLE `workflows` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` integer,
	`workflow_name` text NOT NULL,
	`instance_id` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`episode_id` text,
	`metadata` text,
	`progress` text,
	`estimated_progress` integer DEFAULT 0,
	`estimated_duration` text,
	`actual_duration` integer,
	`error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `tasks` ADD `workflow_id` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `workflow_instance_id` text;