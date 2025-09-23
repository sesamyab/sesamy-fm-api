-- Step 1: Create new organizations table with auth0_org_id as primary key
CREATE TABLE `organizations_new` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);--> statement-breakpoint

-- Step 2: Copy data from old table, using auth0_org_id as the new id
INSERT INTO `organizations_new` (`id`, `name`, `created_at`, `updated_at`)
SELECT `auth0_org_id`, `name`, `created_at`, `updated_at` FROM `organizations`;--> statement-breakpoint

-- Step 3: Update foreign key references in dependent tables that have organization_id column
-- Update shows table
UPDATE `shows` SET `organization_id` = (
  SELECT `auth0_org_id` FROM `organizations` WHERE `organizations`.`id` = `shows`.`organization_id`
) WHERE EXISTS (
  SELECT 1 FROM `organizations` WHERE `organizations`.`id` = `shows`.`organization_id`
);--> statement-breakpoint

-- Update episodes table  
UPDATE `episodes` SET `organization_id` = (
  SELECT `auth0_org_id` FROM `organizations` WHERE `organizations`.`id` = `episodes`.`organization_id`
) WHERE EXISTS (
  SELECT 1 FROM `organizations` WHERE `organizations`.`id` = `episodes`.`organization_id`
);--> statement-breakpoint

-- Update campaigns table
UPDATE `campaigns` SET `organization_id` = (
  SELECT `auth0_org_id` FROM `organizations` WHERE `organizations`.`id` = `campaigns`.`organization_id`
) WHERE EXISTS (
  SELECT 1 FROM `organizations` WHERE `organizations`.`id` = `campaigns`.`organization_id`
);--> statement-breakpoint

-- Step 4: Drop the old organizations table
DROP TABLE `organizations`;--> statement-breakpoint

-- Step 5: Rename the new table to organizations
ALTER TABLE `organizations_new` RENAME TO `organizations`;