-- Add name column with a default value for existing rows
ALTER TABLE `tasks` ADD `name` text NOT NULL DEFAULT 'Unknown Task';

-- Update existing tasks to have proper names based on their type
UPDATE `tasks` SET `name` = 
  CASE 
    WHEN `type` = 'audio_processing' THEN 'Audio Processing'
    WHEN `type` = 'import_show' THEN 'Import Show'
    WHEN `type` = 'tts_generation' THEN 'TTS Generation'
    ELSE 'Unknown Task'
  END
WHERE `name` = 'Unknown Task';