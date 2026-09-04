CREATE TABLE `products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`nutrients` text DEFAULT '{}' NOT NULL,
	`default_dose` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	CONSTRAINT "products_kind_valid" CHECK("products"."kind" IN ('fertilizer','food'))
);
--> statement-breakpoint
CREATE INDEX `idx_products_kind` ON `products` (`kind`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_products_kind_name` ON `products` (`kind`,`name`) WHERE "products"."deleted_at" IS NULL;--> statement-breakpoint
-- Carry the existing per-tank food list into the inventory BEFORE the column
-- goes. `feed` plans key their detailData by the food NAME, so the names have
-- to survive verbatim or every existing feeding plan loses its doses.
-- GROUP BY (not DISTINCT): the same food in two tanks is one product, and we
-- keep one of its dose strings rather than dropping it.
INSERT INTO `products` (`kind`, `name`, `default_dose`, `nutrients`)
SELECT 'food',
       TRIM(json_extract(f.value, '$.name')),
       NULLIF(TRIM(COALESCE(json_extract(f.value, '$.amount'), '') || ' ' ||
                   COALESCE(json_extract(f.value, '$.unit'), '')), ''),
       '{}'
FROM `tanks` t, json_each(t.`foods`) f
WHERE t.`deleted_at` IS NULL
  AND json_valid(t.`foods`)
  AND TRIM(COALESCE(json_extract(f.value, '$.name'), '')) <> ''
GROUP BY TRIM(json_extract(f.value, '$.name'));--> statement-breakpoint
ALTER TABLE `tanks` DROP COLUMN `foods`;