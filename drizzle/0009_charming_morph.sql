-- Make fileUrl and duration nullable in creatives table
-- SQLite doesn't support ALTER COLUMN directly, so we need to recreate the table

-- Step 1: Create temporary table with new structure
CREATE TABLE creatives_temp (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  file_url TEXT,
  duration INTEGER,
  placement_type TEXT NOT NULL DEFAULT 'any',
  language TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Step 2: Copy data from old table to temporary table
INSERT INTO creatives_temp SELECT * FROM creatives;

-- Step 3: Drop old table
DROP TABLE creatives;

-- Step 4: Rename temporary table
ALTER TABLE creatives_temp RENAME TO creatives;