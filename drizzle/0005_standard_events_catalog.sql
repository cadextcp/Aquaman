-- Standard-events catalog (action-types.ts): action_type is no longer a free
-- string — it must be one of the 10 catalog keys. Existing rows outside the
-- catalog are removed (owner decision: no non-catalog action_type ever
-- reached the catalog's union of UI dropdown / plan types / icon map, so this
-- is expected to be a no-op on real data). The one incomplete `fertilize`
-- log written via the new /api/v1/actions endpoint before it supported
-- detail_data is also removed explicitly, per owner request — it must not be
-- migrated forward with empty details.
DELETE FROM `maintenance_logs` WHERE `action_type` NOT IN ('water_change','feed','fertilize','water_test','substrate_vacuum','filter_change','filter_clean','water_top_up','glass_clean','plant_trim');--> statement-breakpoint
DELETE FROM `schedules` WHERE `action_type` NOT IN ('water_change','feed','fertilize','water_test','substrate_vacuum','filter_change','filter_clean','water_top_up','glass_clean','plant_trim');--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_maintenance_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tank_id` integer NOT NULL,
	`action_type` text NOT NULL,
	`done_at` text NOT NULL,
	`note` text,
	`source` text DEFAULT 'user' NOT NULL,
	`schedule_id` integer,
	`details` text,
	`detail_data` text,
	FOREIGN KEY (`tank_id`) REFERENCES `tanks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`schedule_id`) REFERENCES `schedules`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "logs_action_type_standard" CHECK("__new_maintenance_logs"."action_type" IN ('water_change','feed','fertilize','water_test','substrate_vacuum','filter_change','filter_clean','water_top_up','glass_clean','plant_trim'))
);
--> statement-breakpoint
INSERT INTO `__new_maintenance_logs`("id", "tank_id", "action_type", "done_at", "note", "source", "schedule_id", "details", "detail_data") SELECT "id", "tank_id", "action_type", "done_at", "note", "source", NULL, NULL, NULL FROM `maintenance_logs`;--> statement-breakpoint
DROP TABLE `maintenance_logs`;--> statement-breakpoint
ALTER TABLE `__new_maintenance_logs` RENAME TO `maintenance_logs`;--> statement-breakpoint
CREATE INDEX `idx_logs_tank` ON `maintenance_logs` (`tank_id`);--> statement-breakpoint
CREATE INDEX `idx_logs_done` ON `maintenance_logs` (`done_at`);--> statement-breakpoint
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
	`details` text,
	`detail_data` text,
	`ends_on` text,
	`schedule_version` integer DEFAULT 0 NOT NULL,
	`tight_gap_policy` text,
	`tight_gap_threshold_pct` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`tank_id`) REFERENCES `tanks`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "schedules_interval_positive" CHECK("__new_schedules"."interval_days" >= 1),
	CONSTRAINT "schedules_preferred_days_range" CHECK("__new_schedules"."preferred_days" >= 1 AND "__new_schedules"."preferred_days" <= 127),
	CONSTRAINT "schedules_tight_gap_pct_range" CHECK("__new_schedules"."tight_gap_threshold_pct" IS NULL OR ("__new_schedules"."tight_gap_threshold_pct" >= 1 AND "__new_schedules"."tight_gap_threshold_pct" <= 99)),
	CONSTRAINT "schedules_action_type_standard" CHECK("__new_schedules"."action_type" IN ('water_change','feed','fertilize','water_test','substrate_vacuum','filter_change','filter_clean','water_top_up','glass_clean','plant_trim'))
);
--> statement-breakpoint
INSERT INTO `__new_schedules`("id", "tank_id", "action_type", "interval_days", "preferred_days", "auto_reschedule", "last_done_at", "snoozed_until", "snooze_source", "details", "detail_data", "ends_on", "schedule_version", "tight_gap_policy", "tight_gap_threshold_pct", "created_at", "updated_at", "active") SELECT "id", "tank_id", "action_type", "interval_days", "preferred_days", "auto_reschedule", "last_done_at", "snoozed_until", "snooze_source", "details", "detail_data", "ends_on", "schedule_version", "tight_gap_policy", "tight_gap_threshold_pct", "created_at", "updated_at", "active" FROM `schedules`;--> statement-breakpoint
DROP TABLE `schedules`;--> statement-breakpoint
ALTER TABLE `__new_schedules` RENAME TO `schedules`;--> statement-breakpoint
CREATE INDEX `idx_schedules_tank` ON `schedules` (`tank_id`);--> statement-breakpoint
CREATE INDEX `idx_schedules_active` ON `schedules` (`active`);--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
-- The specific incomplete fertilize log from the day the /api/v1/actions
-- endpoint shipped, before it carried detail_data — explicitly not migrated
-- forward (owner request), rather than left with empty details.
DELETE FROM `maintenance_logs` WHERE `source` = 'api' AND `action_type` = 'fertilize' AND `detail_data` IS NULL;
