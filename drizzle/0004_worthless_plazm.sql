CREATE TABLE `ai_call_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`purpose` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`request_json` text NOT NULL,
	`response_json` text,
	`error` text,
	`duration_ms` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_ai_call_logs_created` ON `ai_call_logs` (`created_at`);