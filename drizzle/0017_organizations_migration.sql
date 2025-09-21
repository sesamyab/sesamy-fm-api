-- Add organizations table and organization_id to existing tables
CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`auth0_org_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organizations_auth0_org_id_unique` ON `organizations` (`auth0_org_id`);
--> statement-breakpoint
ALTER TABLE `shows` ADD `organization_id` text NOT NULL DEFAULT 'default-org';
--> statement-breakpoint
ALTER TABLE `episodes` ADD `organization_id` text NOT NULL DEFAULT 'default-org';
--> statement-breakpoint
ALTER TABLE `campaigns` ADD `organization_id` text NOT NULL DEFAULT 'default-org';
--> statement-breakpoint
-- Insert a default organization for existing data
INSERT INTO `organizations` (`id`, `name`, `auth0_org_id`, `created_at`, `updated_at`) 
VALUES ('default-org', 'Default Organization', 'default-org-auth0', datetime('now'), datetime('now'));
