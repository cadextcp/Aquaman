DROP INDEX `uq_products_kind_name`;--> statement-breakpoint
ALTER TABLE `products` ADD `archived_at` text;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_products_kind_name` ON `products` (`kind`,`name`) WHERE "products"."deleted_at" IS NULL AND "products"."archived_at" IS NULL;