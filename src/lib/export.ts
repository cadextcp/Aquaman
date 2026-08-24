/**
 * JSON export/import (Phase 5 — PRD §5.9, "no lock-in" promise).
 *
 * Export: all USER data tables — tanks, schedules, maintenanceLogs,
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
import { tanks, schedules, maintenanceLogs, waterTests, feedLogs, aiCalls } from "@/lib/db/schema";
import { APP_VERSION } from "./version";

export const EXPORT_FORMAT_VERSION = 1 as const;

export type ExportSnapshot = {
  format: typeof EXPORT_FORMAT_VERSION;
  app: "aquaman";
  appVersion: string;
  exportedAt: string; // ISO-8601 UTC
  tanks: unknown[];
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
  actionType: z.string().min(1).max(40),
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
  createdAt: isoString,
  updatedAt: isoString,
  active: z.boolean(),
});

export const maintenanceLogRowSchema = z.object({
  id: z.number().int().positive(),
  tankId: z.number().int().positive(),
  actionType: z.string().min(1).max(40),
  doneAt: isoString,
  note: z.string().max(500).nullable(),
  source: z.enum(["user", "ai_proposed"]),
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

export const importSnapshotSchema = z.object({
  format: z.literal(EXPORT_FORMAT_VERSION),
  app: z.literal("aquaman"),
  appVersion: z.string().max(40).optional(),
  exportedAt: isoString.optional(),
  tanks: z.array(tankRowSchema).max(1000),
  schedules: z.array(scheduleRowSchema).max(5000),
  maintenanceLogs: z.array(maintenanceLogRowSchema).max(50_000),
  waterTests: z.array(waterTestRowSchema).max(50_000),
  feedLogs: z.array(feedLogRowSchema).max(100_000),
  aiCalls: z.array(aiCallRowSchema).max(100_000),
});

export type ImportSnapshot = z.infer<typeof importSnapshotSchema>;

export type ImportResult = {
  tanks: number;
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
  for (const s of snap.schedules) if (!tankIds.has(s.tankId)) return `schedule #${s.id} references missing tank ${s.tankId}`;
  for (const l of snap.maintenanceLogs) if (!tankIds.has(l.tankId)) return `maintenance log #${l.id} references missing tank ${l.tankId}`;
  for (const w of snap.waterTests) if (!tankIds.has(w.tankId)) return `water test #${w.id} references missing tank ${w.tankId}`;
  for (const f of snap.feedLogs) if (!tankIds.has(f.tankId)) return `feed log #${f.id} references missing tank ${f.tankId}`;
  return null;
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
    tx.delete(aiCalls).run();

    for (const row of snap.tanks) tx.insert(tanks).values([row]).run();
    for (const row of snap.schedules) tx.insert(schedules).values([row]).run();
    for (const row of snap.maintenanceLogs) tx.insert(maintenanceLogs).values([row]).run();
    for (const row of snap.waterTests) tx.insert(waterTests).values([row]).run();
    for (const row of snap.feedLogs) tx.insert(feedLogs).values([row]).run();
    for (const row of snap.aiCalls) tx.insert(aiCalls).values([row]).run();
  });

  return {
    tanks: snap.tanks.length,
    schedules: snap.schedules.length,
    maintenanceLogs: snap.maintenanceLogs.length,
    waterTests: snap.waterTests.length,
    feedLogs: snap.feedLogs.length,
    aiCalls: snap.aiCalls.length,
  };
}
