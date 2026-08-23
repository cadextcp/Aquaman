/**
 * Idempotent migrate+seed on boot (used by `npm run dev` and Docker CMD).
 * Safe to run repeatedly — migrations are tracked by drizzle, seed uses
 * INSERT OR IGNORE on stable keys.
 */
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { db } from "../src/lib/db";

function main() {
  console.log("[db:ensure] applying migrations …");
  migrate(db, { migrationsFolder: "./drizzle" });
  console.log("[db:ensure] done");
}

main();
