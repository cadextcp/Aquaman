CREATE TABLE `ai_calls` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`day` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`prompt_tokens` integer DEFAULT 0 NOT NULL,
	`completion_tokens` integer DEFAULT 0 NOT NULL,
	`cost_estimate_micros` integer DEFAULT 0 NOT NULL,
	`purpose` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_ai_day` ON `ai_calls` (`day`);--> statement-breakpoint
CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `feed_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tank_id` integer NOT NULL,
	`day` text NOT NULL,
	`fed_at` text NOT NULL,
	`times_fed` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`tank_id`) REFERENCES `tanks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_feed_day` ON `feed_logs` (`tank_id`,`day`);--> statement-breakpoint
CREATE TABLE `maintenance_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tank_id` integer NOT NULL,
	`action_type` text NOT NULL,
	`done_at` text NOT NULL,
	`note` text,
	`source` text DEFAULT 'user' NOT NULL,
	FOREIGN KEY (`tank_id`) REFERENCES `tanks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_logs_tank` ON `maintenance_logs` (`tank_id`);--> statement-breakpoint
CREATE INDEX `idx_logs_done` ON `maintenance_logs` (`done_at`);--> statement-breakpoint
CREATE TABLE `schedules` (
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
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`tank_id`) REFERENCES `tanks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_schedules_tank` ON `schedules` (`tank_id`);--> statement-breakpoint
CREATE INDEX `idx_schedules_active` ON `schedules` (`active`);--> statement-breakpoint
CREATE TABLE `tanks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`volume_l` integer NOT NULL,
	`water_type` text DEFAULT 'fresh' NOT NULL,
	`photo_path` text,
	`plants` text DEFAULT '[]' NOT NULL,
	`fish` text DEFAULT '[]' NOT NULL,
	`has_co2` integer DEFAULT false NOT NULL,
	`has_heater` integer DEFAULT false NOT NULL,
	`has_filter` integer DEFAULT true NOT NULL,
	`filter_type` text,
	`tank_state` text DEFAULT 'established' NOT NULL,
	`param_overrides` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `water_tests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tank_id` integer NOT NULL,
	`measured_at` text NOT NULL,
	`values` text NOT NULL,
	`note` text,
	FOREIGN KEY (`tank_id`) REFERENCES `tanks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_tests_tank` ON `water_tests` (`tank_id`);--> statement-breakpoint
CREATE INDEX `idx_tests_measured` ON `water_tests` (`measured_at`);