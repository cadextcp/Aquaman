/**
 * Idempotent migrate+seed on boot (used by `npm run dev` and Docker CMD).
 * Safe to run repeatedly — migrations are tracked by drizzle, seed uses
 * INSERT OR IGNORE on stable keys.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { db } from "../src/lib/db";

const MIGRATIONS_FOLDER = "./drizzle";

type JournalEntry = { tag: string; when: number };

function journalEntries(): JournalEntry[] {
  const journal = readFileSync(path.join(MIGRATIONS_FOLDER, "meta", "_journal.json"), "utf8");
  return (JSON.parse(journal) as { entries: JournalEntry[] }).entries;
}

/**
 * Drizzle applies a migration only when its journal `when` is GREATER than the
 * newest `created_at` already in `__drizzle_migrations` — an out-of-order
 * timestamp makes it skip the file silently, with no error and no table.
 * (That is how 0007_product_inventory never reached production: 0006 carried a
 * hand-written timestamp dated after it.) Catch it here instead of in a 500.
 */
function assertAscending(entries: JournalEntry[]): void {
  for (let i = 1; i < entries.length; i++) {
    if (entries[i].when <= entries[i - 1].when) {
      throw new Error(
        `[db:ensure] migration journal is out of order: "${entries[i].tag}" (when=${entries[i].when}) ` +
          `is not newer than "${entries[i - 1].tag}" (when=${entries[i - 1].when}). ` +
          `Drizzle would skip it without applying it — raise its "when" in drizzle/meta/_journal.json.`,
      );
    }
  }
}

/** Every journal entry must have left a row behind; drizzle stores `when` as `created_at`. */
function assertAllApplied(entries: JournalEntry[]): void {
  const applied = new Set(
    (db.$client.prepare("select created_at from __drizzle_migrations").all() as { created_at: number }[]).map(
      (row) => Number(row.created_at),
    ),
  );
  const missing = entries.filter((e) => !applied.has(e.when));
  if (missing.length > 0) {
    throw new Error(
      `[db:ensure] migrations were not applied: ${missing.map((m) => m.tag).join(", ")}. ` +
        `The database is older than the code — do not serve traffic against it.`,
    );
  }
}

function main() {
  console.log("[db:ensure] applying migrations …");
  const entries = journalEntries();
  assertAscending(entries);
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  assertAllApplied(entries);
  console.log(`[db:ensure] done — ${entries.length} migrations applied`);
}

main();
