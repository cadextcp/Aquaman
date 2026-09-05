/**
 * JSON export/import (Phase 5 — PRD §5.9, "no lock-in" promise).
 *
 * Export: all USER data tables — tanks, products, schedules, maintenanceLogs,
 * waterTests, feedLogs, aiCalls (usage history; counters only, no secrets).
 * appSettings is deliberately NOT exported: it holds the ICS token (secret)
 * and the seeded range catalogs (a fresh install re-seeds those). Tank-level
 * paramOverrides travel inside the tanks rows, so per-tank tuning survives.
 *
 * Import: zod-validated, transactional (SQLite: single BEGIN/COMMIT around
 * all deletes+inserts), preserving original IDs so schedules→tanks foreign
 * keys stay intact. REPLACE semantics: existing rows in these tables are
 * deleted first — the snapshot becomes the full state (PRD: "Export → fresh
 * instance → import → identical data state").
 */

import { z } from "zod";
import { db } from "@/lib/db";
import { tanks, schedules, maintenanceLogs, waterTests, feedLogs, aiCalls, products } from "@/lib/db/schema";
import { APP_VERSION } from "./version";
import { ACTION_TYPE_KEYS } from "./domain/action-types";
import { nutrientMapSchema } from "./schemas";

const actionTypeEnum = z.enum(ACTION_TYPE_KEYS as [string, ...string[]]);

/**
 * 2 since the product inventory (migration 0007). Format 1 is still accepted
 * on import: its food list lives on the tanks, and importing it has to lift
 * that into `products` — the column it used to go into no longer exists, and
 * dropping it silently would lose the user's food list on a restore.
 */
export const EXPORT_FORMAT_VERSION = 2 as const;

export type ExportSnapshot = {
  format: typeof EXPORT_FORMAT_VERSION;
  app: "aquaman";
  appVersion: string;
  exportedAt: string; // ISO-8601 UTC
  tanks: unknown[];
  products: unknown[];
  schedules: unknown[];
  maintenanceLogs: unknown[];
  waterTests: unknown[];
  feedLogs: unknown[];
  aiCalls: unknown[];
};

export function buildExportSnapshot(now: Date = new Date()): ExportSnapshot {
  return {
    format: EXPORT_FORMAT_VERSION,
    app: "aquaman",
    appVersion: APP_VERSION,
    exportedAt: now.toISOString(),
    tanks: db.select().from(tanks).all(),
    products: db.select().from(products).all(),
    schedules: db.select().from(schedules).all(),
    maintenanceLogs: db.select().from(maintenanceLogs).all(),
    waterTests: db.select().from(waterTests).all(),
    feedLogs: db.select().from(feedLogs).all(),
    aiCalls: db.select().from(aiCalls).all(),
  };
}

// ==================== import schema ====================

const isoString = z.string().min(1).max(40);
const nullableIso = isoString.nullable();

export const tankRowSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(60),
  volumeL: z.number().int().min(1).max(100000),
  waterType: z.enum(["fresh", "salt"]),
  photoPath: z.string().max(300).nullable(),
  plants: z.array(z.object({ name: z.string().min(1).max(80), qty: z.number().int().min(0).max(999) })).max(50),
  fish: z.array(z.object({ species: z.string().min(1).max(80), qty: z.number().int().min(0).max(999) })).max(50),
  hasCo2: z.boolean(),
  hasHeater: z.boolean(),
  hasFilter: z.boolean(),
  filterType: z.string().max(60).nullable(),
  tankState: z.enum(["cycling", "established"]),
  // Free-text feeding plan (0009) — optional so pre-0009 exports stay importable.
  feedingPlan: z.string().max(4000).nullable().optional(),
  // Format 1 only (v0.3–v1.0): the food list used to live on the tank. The
  // column is gone since migration 0007, so this is read on import purely to
  // lift the names into `products` — never written back to `tanks`.
  foods: z.array(z.object({ name: z.string().min(1).max(60), amount: z.string().max(30), unit: z.string().max(20) })).max(20).nullable().optional(),
  paramOverrides: z.record(
    z.string(),
    z.object({ min: z.number().optional(), max: z.number().optional(), warnMin: z.number().optional(), warnMax: z.number().optional() }),
  ),
  createdAt: isoString,
  deletedAt: nullableIso,
});

export const scheduleRowSchema = z.object({
  id: z.number().int().positive(),
  tankId: z.number().int().positive(),
  actionType: actionTypeEnum,
  intervalDays: z.number().int().min(1).max(365),
  preferredDays: z.number().int().min(1).max(127),
  autoReschedule: z.boolean(),
  lastDoneAt: nullableIso,
  snoozedUntil: nullableIso,
  snoozeSource: z.enum(["user"]).nullable(),
  scheduleVersion: z.number().int().min(0).max(1_000_000),
  tightGapPolicy: z.enum(["fixed", "suppress"]).nullable(),
  tightGapThresholdPct: z.number().int().min(1).max(99).nullable(),
  // v0.2.0 (issues #30/#31) — optional so v0.1.0 exports stay importable
  details: z.string().max(300).nullable().optional(),
  endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  // v0.3 (issue #42) — structured details, optional for older exports
  detailData: z.record(z.string(), z.unknown()).nullable().optional(),
  createdAt: isoString,
  updatedAt: isoString,
  active: z.boolean(),
});

export const maintenanceLogRowSchema = z.object({
  id: z.number().int().positive(),
  tankId: z.number().int().positive(),
  actionType: actionTypeEnum,
  doneAt: isoString,
  note: z.string().max(500).nullable(),
  // 'mcp'/'api' were missing here even though the DB has allowed them since
  // the MCP/v1-REST-API launches — older exports predate both, so keep this
  // optional-safe rather than tightening further.
  source: z.enum(["user", "ai_proposed", "mcp", "api"]),
  // issue: standard-events catalog — optional so exports made before this
  // change stay importable (older rows have no schedule link / detailData)
  scheduleId: z.number().int().positive().nullable().optional(),
  details: z.string().max(300).nullable().optional(),
  detailData: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const waterTestRowSchema = z.object({
  id: z.number().int().positive(),
  tankId: z.number().int().positive(),
  measuredAt: isoString,
  values: z.record(z.string(), z.number().nonnegative().nullable()),
  note: z.string().max(500).nullable(),
});

export const feedLogRowSchema = z.object({
  id: z.number().int().positive(),
  tankId: z.number().int().positive(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fedAt: isoString,
  timesFed: z.number().int().min(0).max(10),
});

export const aiCallRowSchema = z.object({
  id: z.number().int().positive(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  provider: z.string().min(1).max(40),
  model: z.string().min(1).max(80),
  promptTokens: z.number().int().min(0).max(100_000_000),
  completionTokens: z.number().int().min(0).max(100_000_000),
  costEstimateMicros: z.number().int().min(0).max(1_000_000_000),
  purpose: z.string().min(1).max(60),
});

const productRowSchema = z.object({
  id: z.number().int().positive(),
  kind: z.enum(["fertilizer", "food"]),
  name: z.string().min(1).max(80),
  description: z.string().max(600).nullable().optional(),
  nutrients: nutrientMapSchema,
  defaultDose: z.string().max(30).nullable().optional(),
  // Optional, so a format-2 backup taken before the source columns existed
  // still validates; present ones survive the round trip instead of being
  // stripped by zod and silently lost on restore.
  sourceUrl: z.string().max(2048).nullable().optional(),
  sourceFetchedAt: nullableIso.optional(),
  // "Used up" marker (0010) — optional so pre-0010 exports stay importable.
  archivedAt: nullableIso.optional(),
  createdAt: isoString,
  deletedAt: nullableIso.optional(),
});

export const importSnapshotSchema = z.object({
  // Both formats are accepted; the difference is handled in importSnapshot().
  format: z.union([z.literal(1), z.literal(2)]),
  app: z.literal("aquaman"),
  appVersion: z.string().max(40).optional(),
  exportedAt: isoString.optional(),
  tanks: z.array(tankRowSchema).max(1000),
  products: z.array(productRowSchema).max(1000).optional().default([]),
  schedules: z.array(scheduleRowSchema).max(5000),
  maintenanceLogs: z.array(maintenanceLogRowSchema).max(50_000),
  waterTests: z.array(waterTestRowSchema).max(50_000),
  feedLogs: z.array(feedLogRowSchema).max(100_000),
  aiCalls: z.array(aiCallRowSchema).max(100_000),
});

export type ImportSnapshot = z.infer<typeof importSnapshotSchema>;

export type ImportResult = {
  tanks: number;
  products: number;
  schedules: number;
  maintenanceLogs: number;
  waterTests: number;
  feedLogs: number;
  aiCalls: number;
};

/**
 * Referential pre-check BEFORE touching the DB: every schedule/log/test/feed
 * row must reference an imported tank id. Returns a human-readable error or
 * null. (FK constraints would also catch this mid-transaction, but a clear
 * upfront message beats a rolled-back generic failure.)
 */
function checkReferences(snap: ImportSnapshot): string | null {
  const tankIds = new Set(snap.tanks.map((t) => t.id));
  const scheduleIds = new Set(snap.schedules.map((s) => s.id));
  for (const s of snap.schedules) if (!tankIds.has(s.tankId)) return `schedule #${s.id} references missing tank ${s.tankId}`;
  for (const l of snap.maintenanceLogs) {
    if (!tankIds.has(l.tankId)) return `maintenance log #${l.id} references missing tank ${l.tankId}`;
    if (l.scheduleId != null && !scheduleIds.has(l.scheduleId)) return `maintenance log #${l.id} references missing schedule ${l.scheduleId}`;
  }
  for (const w of snap.waterTests) if (!tankIds.has(w.tankId)) return `water test #${w.id} references missing tank ${w.tankId}`;
  for (const f of snap.feedLogs) if (!tankIds.has(f.tankId)) return `feed log #${f.id} references missing tank ${f.tankId}`;
  return null;
}

/**
 * Foods carried on format-1 tank rows that no product in the snapshot already
 * covers — deduplicated by name, first dose wins, blank names skipped. Mirrors
 * the INSERT in migration 0007 so a restored backup and a migrated database
 * end up with the same inventory.
 */
function liftedFoodNames(snap: ImportSnapshot): { name: string; dose: string | null }[] {
  const taken = new Set(snap.products.filter((p) => p.kind === "food").map((p) => p.name));
  const out: { name: string; dose: string | null }[] = [];
  for (const tank of snap.tanks) {
    if (tank.deletedAt) continue; // deleted tanks are skipped, exactly as in 0007
    for (const food of tank.foods ?? []) {
      const name = food.name.trim();
      if (!name || taken.has(name)) continue;
      taken.add(name);
      out.push({ name, dose: `${food.amount} ${food.unit}`.trim() || null });
    }
  }
  return out;
}

/**
 * Import a snapshot: validate (zod), pre-check references, then replace the
 * data tables transactionally. Throws on invalid input (caller maps to a
 * friendly error); on any SQL failure the transaction rolls back and the
 * previous state is untouched.
 */
export function importSnapshot(raw: unknown): ImportResult {
  const parsed = importSnapshotSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(`Invalid snapshot: ${first.path.join(".")} — ${first.message}`);
  }
  const snap = parsed.data;

  const refErr = checkReferences(snap);
  if (refErr) throw new Error(`Broken references: ${refErr}`);

  db.transaction((tx) => {
    // children first, then parents — FK-safe delete order
    tx.delete(feedLogs).run();
    tx.delete(waterTests).run();
    tx.delete(maintenanceLogs).run();
    tx.delete(schedules).run();
    tx.delete(tanks).run();
    tx.delete(products).run();
    tx.delete(aiCalls).run();

    // `foods` is a format-1 leftover on the tank row and has no column any
    // more — strip it before the insert instead of letting drizzle reject it.
    for (const row of snap.tanks) {
      const { foods: _legacyFoods, ...tank } = row;
      void _legacyFoods;
      tx.insert(tanks).values([tank]).run();
    }
    for (const row of snap.products) tx.insert(products).values([{ ...row, deletedAt: row.deletedAt ?? null }]).run();
    // Format-1 lift: the snapshot's food list sits on the tanks. Without this
    // a restore from a v1.0 backup would silently lose every food the user had
    // typed in — the same move migration 0007 makes, one name per product.
    for (const name of liftedFoodNames(snap)) {
      tx.insert(products).values([{ kind: "food", name: name.name, defaultDose: name.dose, nutrients: {} }]).run();
    }
    // Feed plans come back INACTIVE (migration 0006): `feed` stopped being a
    // schedulable type because the feeding counter can never tick such a plan
    // off. A snapshot taken before that still carries active ones, and an
    // import is the one path that writes `schedules` without going through
    // zod's SCHEDULABLE_ACTION_TYPES — restoring it verbatim would put the
    // never-satisfiable plan straight back in the care queue. The row itself is
    // kept (history, `maintenance_logs.schedule_id`), exactly like the migration.
    for (const row of snap.schedules)
      tx.insert(schedules).values([row.actionType === "feed" ? { ...row, active: false } : row]).run();
    for (const row of snap.maintenanceLogs) tx.insert(maintenanceLogs).values([row]).run();
    for (const row of snap.waterTests) tx.insert(waterTests).values([row]).run();
    for (const row of snap.feedLogs) tx.insert(feedLogs).values([row]).run();
    for (const row of snap.aiCalls) tx.insert(aiCalls).values([row]).run();
  });

  return {
    tanks: snap.tanks.length,
    products: snap.products.length + liftedFoodNames(snap).length,
    schedules: snap.schedules.length,
    maintenanceLogs: snap.maintenanceLogs.length,
    waterTests: snap.waterTests.length,
    feedLogs: snap.feedLogs.length,
    aiCalls: snap.aiCalls.length,
  };
}
