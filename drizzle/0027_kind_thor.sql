-- SQLite does not support "Drop not null from column" natively
-- We need to recreate the table to make description nullable

-- Create new episodes table with description nullable
CREATE TABLE episodes_new (
  id text PRIMARY KEY NOT NULL,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  show_id text NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  image_url text,
  audio_url text,
  transcript_url text,
  script_url text,
  encoded_audio_urls text,
  published integer DEFAULT 0,
  published_at text,
  duration integer,
  episode_number integer,
  season_number integer,
  episode_type text,
  author text,
  subtitle text,
  explicit integer,
  keywords text,
  ad_markers text,
  chapters text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

-- Copy data from old table, ensuring created_at and updated_at have values
INSERT INTO episodes_new 
SELECT 
  id,
  organization_id,
  show_id,
  title,
  description,
  image_url,
  audio_url,
  transcript_url,
  script_url,
  encoded_audio_urls,
  published,
  published_at,
  duration,
  episode_number,
  season_number,
  episode_type,
  author,
  subtitle,
  explicit,
  keywords,
  ad_markers,
  chapters,
  COALESCE(created_at, datetime('now')),
  COALESCE(updated_at, datetime('now'))
FROM episodes;

-- Drop old table
DROP TABLE episodes;

-- Rename new table
ALTER TABLE episodes_new RENAME TO episodes;
