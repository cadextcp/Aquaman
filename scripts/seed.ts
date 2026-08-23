/**
 * Seed: default maintenance actions and water-parameter target ranges.
 *
 * Range seeding is VERSIONED (issue #8): seeds store a `rangesVersion` and the
 * current catalog fingerprints. If ranges.ts changes (band corrections!), the
 * stored values are UPDATED unless the user overrode them per-tank
 * (`tanks.paramOverrides` wins anyway — overrides live on the tank, not here).
 * User-modified global ranges are detected via a `modified` flag and left alone.
 */
import { db } from "../src/lib/db";
import { appSettings } from "../src/lib/db/schema";
import { FRESHWATER_RANGES, SALTWATER_RANGES, DEFAULT_ACTIONS } from "../src/lib/domain/ranges";

const RANGES_VERSION = 2; // bump when bands change so seeds update existing installs

type StoredRanges = { version: number; modified?: boolean };

function seedSetting(key: string, value: unknown): void {
  db.insert(appSettings)
    .values({ key, value: value as never })
    .onConflictDoNothing()
    .run();
}

function seedVersionedSetting(key: string, catalog: unknown): void {
  const existing = db.select().from(appSettings).all().find((r) => r.key === key);
  if (!existing) {
    db.insert(appSettings).values({ key, value: { version: RANGES_VERSION, modified: false, ranges: catalog } as never }).run();
    return;
  }
  const stored = existing.value as StoredRanges | { version?: number; modified?: boolean } | unknown[];
  // legacy (Phase 1) shape: plain array without version → migrate to versioned
  const isLegacy = Array.isArray(stored) || stored === null || (stored as StoredRanges).version === undefined;
  const userModified = !isLegacy && ((stored as StoredRanges).modified ?? false);
  if (userModified) return; // never clobber user edits
  db.update(appSettings)
    .set({ value: { version: RANGES_VERSION, modified: false, ranges: catalog } as never })
    .where(eqKey(key))
    .run();
}

// tiny helper to avoid importing eq into two files
import { eq } from "drizzle-orm";
function eqKey(key: string) {
  return eq(appSettings.key, key);
}

function main() {
  console.log("[db:seed] seeding defaults (rangesVersion", RANGES_VERSION + ") …");

  seedSetting("defaultActions", DEFAULT_ACTIONS);
  seedVersionedSetting("freshwaterRanges", FRESHWATER_RANGES);
  seedVersionedSetting("saltwaterRanges", SALTWATER_RANGES);

  const rows = db.select().from(appSettings).all();
  console.log(`[db:seed] appSettings rows: ${rows.length}`);
  console.log("[db:seed] done");
}

main();
