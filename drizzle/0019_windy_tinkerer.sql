-- Step 1: Create new tasks table with organization_id column
CREATE TABLE `tasks_new` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`payload` text,
	`result` text,
	`error` text,
	`attempts` integer DEFAULT 0,
	`started_at` text,
	`progress` integer DEFAULT 0,
	`step` text,
	`workflow_id` text,
	`workflow_instance_id` text,
	`organization_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint

-- Step 2: Copy existing tasks with a default organization_id (we'll need to update these manually later)
-- For now, we'll use the first organization in the table as the default
INSERT INTO `tasks_new` (
	`id`, `type`, `status`, `payload`, `result`, `error`, `attempts`, 
	`started_at`, `progress`, `step`, `workflow_id`, `workflow_instance_id`, 
	`organization_id`, `created_at`, `updated_at`
)
SELECT 
	`id`, `type`, `status`, `payload`, `result`, `error`, `attempts`, 
	`started_at`, `progress`, `step`, `workflow_id`, `workflow_instance_id`, 
	(SELECT `id` FROM `organizations` LIMIT 1) as `organization_id`,
	`created_at`, `updated_at`
FROM `tasks`;--> statement-breakpoint

-- Step 3: Drop old table and rename new one
DROP TABLE `tasks`;--> statement-breakpoint
ALTER TABLE `tasks_new` RENAME TO `tasks`;