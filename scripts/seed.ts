/**
 * Seed: default maintenance actions and water-parameter target ranges.
 * Idempotent via INSERT OR IGNORE on stable keys.
 */
import { db } from "../src/lib/db";
import { appSettings } from "../src/lib/db/schema";
import { FRESHWATER_RANGES, SALTWATER_RANGES, DEFAULT_ACTIONS } from "../src/lib/domain/ranges";

function main() {
  console.log("[db:seed] seeding defaults …");

  db.insert(appSettings)
    .values([
      { key: "defaultActions", value: DEFAULT_ACTIONS },
      { key: "freshwaterRanges", value: FRESHWATER_RANGES },
      { key: "saltwaterRanges", value: SALTWATER_RANGES },
    ])
    .onConflictDoNothing()
    .run();

  // sanity check
  const rows = db.select().from(appSettings).all();
  console.log(`[db:seed] appSettings rows: ${rows.length}`);
  console.log("[db:seed] done");
}

main();
