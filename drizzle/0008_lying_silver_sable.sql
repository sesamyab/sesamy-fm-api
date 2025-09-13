-- Make startDate and endDate nullable in campaigns table
-- SQLite doesn't support ALTER COLUMN directly, so we need to recreate the table

-- Step 1: Create temporary table with new structure
CREATE TABLE campaigns_temp (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  advertiser TEXT,
  start_date TEXT,
  end_date TEXT,
  target_impressions INTEGER,
  priority INTEGER NOT NULL DEFAULT 5,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Step 2: Copy data from old table to temporary table
INSERT INTO campaigns_temp SELECT * FROM campaigns;

-- Step 3: Drop old table
DROP TABLE campaigns;

-- Step 4: Rename temporary table
ALTER TABLE campaigns_temp RENAME TO campaigns;