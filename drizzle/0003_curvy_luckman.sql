ALTER TABLE `schedules` ADD `detail_data` text;--> statement-breakpoint
ALTER TABLE `tanks` ADD `foods` text DEFAULT '[]' NOT NULL;