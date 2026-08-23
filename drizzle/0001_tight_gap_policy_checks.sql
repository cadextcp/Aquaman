ALTER TABLE `schedules` ADD `tight_gap_policy` text;--> statement-breakpoint
ALTER TABLE `schedules` ADD `tight_gap_threshold_pct` integer;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_schedules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tank_id` integer NOT NULL,
	`action_type` text NOT NULL,
	`interval_days` integer NOT NULL,
	`preferred_days` integer DEFAULT 127 NOT NULL,
	`auto_reschedule` integer DEFAULT true NOT NULL,
	`last_done_at` text,
	`snoozed_until` text,
	`snooze_source` text,
	`schedule_version` integer DEFAULT 0 NOT NULL,
	`tight_gap_policy` text,
	`tight_gap_threshold_pct` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`tank_id`) REFERENCES `tanks`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "schedules_interval_positive" CHECK(`interval_days` >= 1),
	CONSTRAINT "schedules_preferred_days_range" CHECK(`preferred_days` >= 1 AND `preferred_days` <= 127),
	CONSTRAINT "schedules_tight_gap_pct_range" CHECK(`tight_gap_threshold_pct` IS NULL OR (`tight_gap_threshold_pct` >= 1 AND `tight_gap_threshold_pct` <= 99))
);--> statement-breakpoint
INSERT INTO `__new_schedules`(`id`,`tank_id`,`action_type`,`interval_days`,`preferred_days`,`auto_reschedule`,`last_done_at`,`snoozed_until`,`snooze_source`,`schedule_version`,`tight_gap_policy`,`tight_gap_threshold_pct`,`created_at`,`updated_at`,`active`)
	SELECT `id`,`tank_id`,`action_type`,`interval_days`,`preferred_days`,`auto_reschedule`,`last_done_at`,`snoozed_until`,`snooze_source`,`schedule_version`,`tight_gap_policy`,`tight_gap_threshold_pct`,`created_at`,`updated_at`,`active` FROM `schedules`;--> statement-breakpoint
DROP TABLE `schedules`;--> statement-breakpoint
ALTER TABLE `__new_schedules` RENAME TO `schedules`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_schedules_tank` ON `schedules` (`tank_id`);--> statement-breakpoint
CREATE INDEX `idx_schedules_active` ON `schedules` (`active`);
