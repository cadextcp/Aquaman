/**
 * The migration journal is deploy-critical bookkeeping, not a generated file
 * nobody reads. Drizzle applies a migration only when its `when` is GREATER
 * than the newest `created_at` already in `__drizzle_migrations`, so a journal
 * entry that is older than the one before it is skipped SILENTLY — no error,
 * no table, just 500s at runtime. That is how 0007_product_inventory missed
 * production: 0006 carried a hand-written timestamp dated after it.
 * CI catches that here now, before an image ships.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle");
const entries = (
  JSON.parse(readFileSync(path.join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8")) as {
    entries: { tag: string; when: number }[];
  }
).entries;

describe("drizzle migration journal", () => {
  // A `when` dated in the future poisons every migration generated before that
  // moment: drizzle-kit stamps new ones with the real clock, which lands below
  // the fake one — which is exactly what 0006 did to 0007. Ordering is the
  // invariant that catches it either way.
  it("orders every entry strictly after the one before it", () => {
    const offenders = entries
      .filter((e, i) => i > 0 && e.when <= entries[i - 1].when)
      .map((e) => e.tag);
    expect(offenders).toEqual([]);
  });

  it("lists every .sql file in the folder, in file-name order", () => {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => f.replace(/\.sql$/, ""))
      .sort();
    expect(entries.map((e) => e.tag)).toEqual(files);
  });
});
