ALTER TABLE `organizations` ADD `tts_model` text;--> statement-breakpoint
ALTER TABLE `organizations` ADD `stt_model` text;--> statement-breakpoint
ALTER TABLE `organizations` ADD `auto_tts` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `shows` ADD `tts_model` text;--> statement-breakpoint
ALTER TABLE `shows` ADD `stt_model` text;--> statement-breakpoint
ALTER TABLE `shows` ADD `auto_tts` integer;