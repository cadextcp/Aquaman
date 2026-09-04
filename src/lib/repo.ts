import { z } from "zod";
import { db } from "@/lib/db";
import { tanks, schedules, maintenanceLogs, waterTests, feedLogs } from "@/lib/db/schema";
import { and, desc, eq, isNull, gte, sql } from "drizzle-orm";
import type { Tank, Schedule, MaintenanceLog, WaterTest, FeedLog } from "@/lib/db/schema";
import {
  snoozeInputSchema,
  waterTestInputSchema,
  validateWaterValues,
  tankInputSchema,
  scheduleInputSchema,
} from "@/lib/schemas";
import { today, addDays } from "@/lib/domain/dates";
import { isStandardPlanType, formatDetailData } from "@/lib/domain/plan-structure";
import { LOGGABLE_ACTION_TYPES } from "@/lib/domain/action-types";
import type { DetailData } from "@/lib/db/schema";
import { failure, type Failure } from "@/lib/domain/errors";

// ==================== Tanks ====================

export function listTanks(): Tank[] {
  return db.select().from(tanks).where(isNull(tanks.deletedAt)).all();
}

export function getTank(id: number): Tank | undefined {
  return db.select().from(tanks).where(and(eq(tanks.id, id), isNull(tanks.deletedAt))).get();
}

// ==================== Schedules ====================

export function listSchedules(tankId?: number): (Schedule & { tankName: string })[] {
  const rows = db
    .select({ s: schedules, tankName: tanks.name })
    .from(schedules)
    .innerJoin(tanks, eq(schedules.tankId, tanks.id))
    .where(and(eq(schedules.active, true), isNull(tanks.deletedAt)))
    .all();
  const filtered = tankId ? rows.filter((r) => r.s.tankId === tankId) : rows;
  return filtered.map((r) => ({ ...r.s, tankName: r.tankName }));
}

/** Single schedule by id, regardless of active/soft-deleted-tank state — the v1 REST API's GET /schedules/{id}. */
export function getSchedule(id: number): Schedule | undefined {
  return db.select().from(schedules).where(eq(schedules.id, id)).get();
}

// ==================== Maintenance logs ====================

export function addMaintenanceLog(entry: {
  tankId: number;
  actionType: string;
  doneAt?: string;
  note?: string;
  source?: "user" | "ai_proposed" | "mcp" | "api";
  scheduleId?: number | null;
  details?: string | null;
  detailData?: DetailData | null;
}): MaintenanceLog {
  return db
    .insert(maintenanceLogs)
    .values({
      tankId: entry.tankId,
      actionType: entry.actionType,
      doneAt: entry.doneAt ?? new Date().toISOString(),
      note: entry.note,
      source: entry.source ?? "user",
      scheduleId: entry.scheduleId ?? null,
      details: entry.details ?? null,
      detailData: entry.detailData ?? null,
    })
    .returning()
    .get();
}

export function recentLogs(tankId: number, limit = 20): MaintenanceLog[] {
  return db
    .select()
    .from(maintenanceLogs)
    .where(eq(maintenanceLogs.tankId, tankId))
    .orderBy(desc(maintenanceLogs.doneAt))
    .limit(limit)
    .all();
}

/**
 * Untruncated completion history for one tank — scheduleAdherence reconstructs
 * the occurrence timeline from it, so a windowed "recent" list would corrupt
 * the grid walk. Oldest first, matching the walk's direction.
 */
export function allLogsForTank(tankId: number): MaintenanceLog[] {
  return db
    .select()
    .from(maintenanceLogs)
    .where(eq(maintenanceLogs.tankId, tankId))
    .orderBy(maintenanceLogs.doneAt)
    .all();
}

// ==================== Water tests ====================

export function addWaterTest(entry: {
  tankId: number;
  measuredAt?: string;
  values: Record<string, number | null>;
  note?: string;
}): WaterTest {
  return db
    .insert(waterTests)
    .values({
      tankId: entry.tankId,
      measuredAt: entry.measuredAt ?? new Date().toISOString(),
      values: entry.values,
      note: entry.note,
    })
    .returning()
    .get();
}

export function waterTestsForTank(tankId: number, days = 365): WaterTest[] {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  return db
    .select()
    .from(waterTests)
    .where(and(eq(waterTests.tankId, tankId), gte(waterTests.measuredAt, since)))
    .orderBy(desc(waterTests.measuredAt))
    .all();
}

// ==================== Feed (daily habit) ====================

export function todayFeed(tankId: number, localDay: string): FeedLog | undefined {
  return db
    .select()
    .from(feedLogs)
    .where(and(eq(feedLogs.tankId, tankId), eq(feedLogs.day, localDay)))
    .get();
}

export function feedAllToday(localDay: string): FeedLog[] {
  return db.select().from(feedLogs).where(eq(feedLogs.day, localDay)).all();
}

/**
 * Last feeding day per tank (`tankId` → YYYY-MM-DD), across all of history.
 *
 * The dashboard's "last fed" line — the thing feeding is actually FOR, now that
 * it has no plan to show a due date. One grouped query rather than `lastFeed()`
 * per tank, because the dashboard renders every visible tank at once.
 *
 * `day` is already the local day string (AQUAMAN_TIMEZONE, written by
 * markFed/adjustFeedCore), so `max()` over it is a plain lexical max — no
 * timezone conversion on the way out.
 */
export function lastFeedDays(): Map<number, string> {
  const rows = db
    .select({ tankId: feedLogs.tankId, day: sql<string>`max(${feedLogs.day})` })
    .from(feedLogs)
    .groupBy(feedLogs.tankId)
    .all();
  return new Map(rows.map((r) => [r.tankId, r.day]));
}

/** Feed history for one tank, most recent day first — the v1 REST API's read side for feedings. */
export function feedLogsForTank(tankId: number, days = 30): FeedLog[] {
  const since = addDays(today(), -days);
  return db
    .select()
    .from(feedLogs)
    .where(and(eq(feedLogs.tankId, tankId), gte(feedLogs.day, since)))
    .orderBy(desc(feedLogs.day))
    .all();
}

/**
 * Cycle 0 → 1 → 2 → 0 within the same local day (issue #26):
 * research says feeding is 1–2×/day, so two is the cap; the wrap back to 0
 * (row deleted) lets a mis-tap be undone with one more tap. Only the
 * CURRENT day's row is ever touched.
 */
export function markFed(tankId: number, localDay: string): FeedLog {
  const existing = todayFeed(tankId, localDay);
  if (!existing) {
    return db
      .insert(feedLogs)
      .values({ tankId, day: localDay, fedAt: new Date().toISOString(), timesFed: 1 })
      .returning()
      .get();
  }
  if (existing.timesFed >= 2) {
    // wrap: back to "not fed today" — undo of an accidental extra tap
    db.delete(feedLogs).where(eq(feedLogs.id, existing.id)).run();
    return { id: existing.id, tankId, day: localDay, fedAt: existing.fedAt, timesFed: 0 };
  }
  return db
    .update(feedLogs)
    .set({ timesFed: existing.timesFed + 1, fedAt: new Date().toISOString() })
    .where(eq(feedLogs.id, existing.id))
    .returning()
    .get();
}

/**
 * Feed ± core for ANY local day (dashboard day navigation, owner request):
 * bounds 0..5, decrement below 0 is a no-op, a count reaching 0 deletes the
 * row ("not fed that day"). Validation of the DAY itself (not future, not
 * older than the backfill window) lives in the action layer.
 */
export function adjustFeedCore(
  tankId: number,
  localDay: string,
  delta: 1 | -1,
): { timesFed: number } {
  const current = todayFeed(tankId, localDay);
  const nowCount = current?.timesFed ?? 0;

  if (delta === -1) {
    if (!current || nowCount <= 0) return { timesFed: 0 };
    if (nowCount === 1) {
      db.delete(feedLogs).where(eq(feedLogs.id, current.id)).run();
      return { timesFed: 0 };
    }
    db.update(feedLogs).set({ timesFed: nowCount - 1 }).where(eq(feedLogs.id, current.id)).run();
    return { timesFed: nowCount - 1 };
  }

  // +1, capped at 5
  if (nowCount >= 5) return { timesFed: nowCount };
  if (current) {
    db.update(feedLogs)
      .set({ timesFed: nowCount + 1, fedAt: new Date().toISOString() })
      .where(eq(feedLogs.id, current.id))
      .run();
  } else {
    db.insert(feedLogs)
      .values({ tankId, day: localDay, fedAt: new Date().toISOString(), timesFed: 1 })
      .run();
  }
  return { timesFed: nowCount + 1 };
}

// ==================== Shared write cores (Server Actions + MCP tools) ====================
//
// The v1.1 MCP write tools must behave EXACTLY like their in-app Server Action
// counterparts (same validation, same side effects) — so the core lives here
// and both callers wrap it. Cores return domain errors as values and only
// throw on unexpected DB failures; UI layers add revalidatePath/plan-review.

export type WriteResult = { ok: true } | Failure;
export type WriteResultWithTank = { ok: true; tankId: number } | Failure;

/** First zod form error, matching what zodFail() in actions.ts shows the user. */
function firstZodError(e: { flatten: () => { formErrors: string[] } }): string {
  return e.flatten().formErrors[0] ?? "Validation failed";
}

/**
 * "Done" core: maintenance-log row + lastDoneAt=now + clear snooze +
 * scheduleVersion bump (ICS SEQUENCE). `source` marks WHO did it — 'mcp'
 * keeps remote (OpenClaw) completions distinguishable in history, 'api'
 * likewise for the v1 REST API's POST /schedules/{id}/done.
 */
export function markScheduleDoneCore(
  scheduleId: number,
  note?: string,
  source: "user" | "ai_proposed" | "mcp" | "api" = "user",
): WriteResultWithTank {
  const s = db.select().from(schedules).where(eq(schedules.id, scheduleId)).get();
  if (!s) return failure("schedule.notFound", "Schedule not found");
  addMaintenanceLog({
    tankId: s.tankId,
    actionType: s.actionType,
    note,
    source,
    scheduleId: s.id,
    details: s.details,
    detailData: s.detailData,
  });
  db.update(schedules)
    .set({
      lastDoneAt: new Date().toISOString(),
      snoozedUntil: null,
      snoozeSource: null,
      scheduleVersion: s.scheduleVersion + 1,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schedules.id, scheduleId))
    .run();
  return { ok: true, tankId: s.tankId };
}

/**
 * Snooze core: same rules as the UI — zod-validated, a past date is
 * rejected (nextDue ignores it, so accepting would be a lie), and the user
 * date is taken LITERALLY (no weekday gridding, issue #6).
 */
export function snoozeScheduleCore(scheduleId: number, until: string): WriteResultWithTank {
  const parsed = snoozeInputSchema.safeParse({ scheduleId, until });
  if (!parsed.success) return failure("validation", firstZodError(parsed.error), { detail: firstZodError(parsed.error) });
  if (until < today()) return failure("snooze.pastDate", "Cannot snooze to a past date");
  const s = db.select().from(schedules).where(eq(schedules.id, scheduleId)).get();
  if (!s) return failure("schedule.notFound", "Schedule not found");
  db.update(schedules)
    .set({
      snoozedUntil: `${until}T00:00:00.000Z`,
      snoozeSource: "user",
      scheduleVersion: s.scheduleVersion + 1,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schedules.id, scheduleId))
    .run();
  return { ok: true, tankId: s.tankId };
}

/**
 * Water-test core: zod + live-tank check + per-parameter whitelist and
 * plausibility bounds (issue #24). NO revalidate/plan-review here — callers
 * add those (an MCP-written test also feeds the coach, so the MCP tool
 * triggers the plan review itself).
 */
export function logWaterTestCore(input: unknown): WriteResultWithTank {
  const parsed = waterTestInputSchema.safeParse(input);
  if (!parsed.success) return failure("validation", firstZodError(parsed.error), { detail: firstZodError(parsed.error) });
  const tank = db.select().from(tanks).where(and(eq(tanks.id, parsed.data.tankId), isNull(tanks.deletedAt))).get();
  if (!tank) return failure("tank.notFound", "Tank not found");
  const [clean, vErr] = validateWaterValues(parsed.data.values, tank.waterType);
  if (vErr || !clean) return failure("values.invalid", vErr ?? "Invalid values", { detail: vErr ?? "" });
  addWaterTest({
    tankId: parsed.data.tankId,
    measuredAt: parsed.data.measuredAt,
    values: clean,
    note: parsed.data.note ?? undefined,
  });
  return { ok: true, tankId: parsed.data.tankId };
}

// ==================== Shared write cores -- Tanks (v1 REST API + Server Actions) ====================
//
// Extracted from src/app/actions.ts (issue: only Server Actions could reach
// this logic, so a non-Next client like the v1 REST API or a display had no
// way in). Same rule as the cores above: validate, mutate, return errors as
// values -- no revalidatePath/requestPlanReview here, callers add those.

export type WriteResultWithId = { ok: true; id: number } | Failure;

export function createTankCore(input: unknown, photoPath?: string | null): WriteResultWithId {
  const parsed = tankInputSchema.safeParse(input);
  if (!parsed.success) return failure("validation", firstZodError(parsed.error), { detail: firstZodError(parsed.error) });
  try {
    const row = db
      .insert(tanks)
      .values({
        name: parsed.data.name,
        volumeL: parsed.data.volumeL,
        waterType: parsed.data.waterType,
        plants: parsed.data.plants,
        fish: parsed.data.fish,
        foods: parsed.data.foods,
        hasCo2: parsed.data.hasCo2,
        hasHeater: parsed.data.hasHeater,
        hasFilter: parsed.data.hasFilter,
        filterType: parsed.data.filterType ?? null,
        tankState: parsed.data.tankState,
        photoPath: photoPath ?? null,
      })
      .returning()
      .get();
    return { ok: true, id: row.id };
  } catch (err) {
    console.error("[createTankCore]", err);
    return failure("tank.createFailed", "Could not create tank");
  }
}

export type UpdateTankResult = { ok: true; masterChanged: boolean } | Failure;

/**
 * `masterChanged` tells the caller whether fish/plants/foods/volume/equipment
 * changed -- that is the plan-review trigger (AI coach), decided by the
 * caller (Server Action / API route), never here (same "cores do not touch
 * AI/cache" rule as logWaterTestCore).
 */
export function updateTankCore(id: number, input: unknown, photoPath?: string | null): UpdateTankResult {
  const parsed = tankInputSchema.safeParse(input);
  if (!parsed.success) return failure("validation", firstZodError(parsed.error), { detail: firstZodError(parsed.error) });
  try {
    const before = db.select().from(tanks).where(and(eq(tanks.id, id), isNull(tanks.deletedAt))).get();
    db.update(tanks)
      .set({
        name: parsed.data.name,
        volumeL: parsed.data.volumeL,
        waterType: parsed.data.waterType,
        plants: parsed.data.plants,
        fish: parsed.data.fish,
        foods: parsed.data.foods,
        hasCo2: parsed.data.hasCo2,
        hasHeater: parsed.data.hasHeater,
        hasFilter: parsed.data.hasFilter,
        filterType: parsed.data.filterType ?? null,
        tankState: parsed.data.tankState,
        ...(photoPath !== undefined ? { photoPath } : {}),
      })
      .where(and(eq(tanks.id, id), isNull(tanks.deletedAt)))
      .run();
    if (!before) return { ok: true, masterChanged: false };
    const masterChanged =
      before.volumeL !== parsed.data.volumeL ||
      JSON.stringify(before.fish) !== JSON.stringify(parsed.data.fish) ||
      JSON.stringify(before.plants) !== JSON.stringify(parsed.data.plants) ||
      JSON.stringify(before.foods ?? []) !== JSON.stringify(parsed.data.foods ?? []) ||
      before.hasCo2 !== parsed.data.hasCo2 ||
      before.hasHeater !== parsed.data.hasHeater ||
      before.hasFilter !== parsed.data.hasFilter ||
      before.filterType !== (parsed.data.filterType ?? null);
    return { ok: true, masterChanged };
  } catch (err) {
    console.error("[updateTankCore]", err);
    return failure("tank.updateFailed", "Could not update tank");
  }
}

/** Soft delete: tanks flagged, never row-deleted (logs/tests reference them). */
export function deleteTankCore(id: number): WriteResult {
  try {
    db.update(tanks).set({ deletedAt: new Date().toISOString() }).where(eq(tanks.id, id)).run();
    db.update(schedules).set({ active: false }).where(eq(schedules.tankId, id)).run();
    return { ok: true };
  } catch (err) {
    console.error("[deleteTankCore]", err);
    return failure("tank.deleteFailed", "Could not delete tank");
  }
}

// ==================== Shared write cores -- Schedules ====================

export function createScheduleCore(input: unknown): WriteResultWithId {
  const parsed = scheduleInputSchema.safeParse(input);
  if (!parsed.success) return failure("validation", firstZodError(parsed.error), { detail: firstZodError(parsed.error) });
  if (!getTank(parsed.data.tankId)) return failure("tank.notFound", "Tank not found");
  // issue #42: one plan per standard type per tank -- duplicates would overlap
  if (isStandardPlanType(parsed.data.actionType)) {
    const existing = db
      .select({ id: schedules.id })
      .from(schedules)
      .where(
        and(
          eq(schedules.tankId, parsed.data.tankId),
          eq(schedules.actionType, parsed.data.actionType),
          eq(schedules.active, true),
        ),
      )
      .get();
    if (existing) {
      return failure(
        "schedule.duplicateType",
        `This tank already has a ${parsed.data.actionType.replace(/_/g, " ")} plan (one per type) -- edit it instead`,
        { action: parsed.data.actionType },
      );
    }
  }
  try {
    const row = db
      .insert(schedules)
      .values({
        tankId: parsed.data.tankId,
        actionType: parsed.data.actionType,
        intervalDays: parsed.data.intervalDays,
        preferredDays: parsed.data.preferredDays,
        autoReschedule: parsed.data.autoReschedule,
        tightGapPolicy: parsed.data.tightGapPolicy,
        tightGapThresholdPct: parsed.data.tightGapThresholdPct,
        details: parsed.data.details ?? null,
        detailData: (parsed.data.detailData as Record<string, unknown> | null | undefined) ?? null,
        endsOn: parsed.data.endsOn ?? null,
      })
      .returning()
      .get();
    return { ok: true, id: row.id };
  } catch (err) {
    console.error("[createScheduleCore]", err);
    return failure("schedule.createFailed", "Could not create schedule");
  }
}

export function updateScheduleCore(id: number, input: unknown): WriteResult {
  const parsed = scheduleInputSchema.safeParse(input);
  if (!parsed.success) return failure("validation", firstZodError(parsed.error), { detail: firstZodError(parsed.error) });
  if (!getTank(parsed.data.tankId)) return failure("tank.notFound", "Tank not found");
  // issue #42: renaming to a standard type another active plan already holds -> block
  if (isStandardPlanType(parsed.data.actionType)) {
    const clash = db
      .select({ id: schedules.id })
      .from(schedules)
      .where(
        and(
          eq(schedules.tankId, parsed.data.tankId),
          eq(schedules.actionType, parsed.data.actionType),
          eq(schedules.active, true),
        ),
      )
      .get();
    if (clash && clash.id !== id) {
      return failure(
        "schedule.duplicateType",
        `This tank already has a ${parsed.data.actionType.replace(/_/g, " ")} plan`,
        { action: parsed.data.actionType },
      );
    }
  }
  try {
    db.update(schedules)
      .set({
        tankId: parsed.data.tankId,
        actionType: parsed.data.actionType,
        intervalDays: parsed.data.intervalDays,
        preferredDays: parsed.data.preferredDays,
        autoReschedule: parsed.data.autoReschedule,
        tightGapPolicy: parsed.data.tightGapPolicy,
        tightGapThresholdPct: parsed.data.tightGapThresholdPct,
        details: parsed.data.details ?? null,
        detailData: (parsed.data.detailData as Record<string, unknown> | null | undefined) ?? null,
        endsOn: parsed.data.endsOn ?? null,
        // atomic increment -- no read-modify-write, no silent ?? 0 (issue #27)
        scheduleVersion: sql`${schedules.scheduleVersion} + 1`,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schedules.id, id))
      .run();
    return { ok: true };
  } catch (err) {
    console.error("[updateScheduleCore]", err);
    return failure("schedule.updateFailed", "Could not update schedule");
  }
}

/**
 * Hard-delete a schedule: nothing references schedules.id -- maintenance logs
 * hang off (tankId, actionType), history stays intact.
 */
export function deleteScheduleCore(id: number): WriteResultWithTank {
  try {
    const s = db.select().from(schedules).where(eq(schedules.id, id)).get();
    if (!s) return failure("schedule.notFound", "Schedule not found");
    db.delete(schedules).where(eq(schedules.id, id)).run();
    return { ok: true, tankId: s.tankId };
  } catch (err) {
    console.error("[deleteScheduleCore]", err);
    return failure("schedule.deleteFailed", "Could not delete schedule");
  }
}

export function setScheduleActiveCore(id: number, active: boolean): WriteResult {
  try {
    db.update(schedules).set({ active, updatedAt: new Date().toISOString() }).where(eq(schedules.id, id)).run();
    return { ok: true };
  } catch (err) {
    console.error("[setScheduleActiveCore]", err);
    return failure("schedule.updateFailed", "Could not update schedule");
  }
}

/**
 * Undo a wrongly marked-done task: deletes the most recent maintenance-log
 * row for this schedule and restores the PREVIOUS lastDoneAt (the
 * second-newest log for this tank+action, or null when the undone one was
 * the first). scheduleVersion bumps so ICS consumers see the change.
 */
export function undoLastDoneCore(scheduleId: number): WriteResultWithTank {
  try {
    const s = db.select().from(schedules).where(eq(schedules.id, scheduleId)).get();
    if (!s) return failure("schedule.notFound", "Schedule not found");
    if (!s.lastDoneAt) return failure("undo.nothing", "Nothing to undo");

    const logs = db
      .select()
      .from(maintenanceLogs)
      .where(and(eq(maintenanceLogs.tankId, s.tankId), eq(maintenanceLogs.actionType, s.actionType)))
      .orderBy(desc(maintenanceLogs.doneAt))
      .limit(2)
      .all();
    if (logs.length === 0) return failure("undo.nothing", "Nothing to undo");

    db.delete(maintenanceLogs).where(eq(maintenanceLogs.id, logs[0].id)).run();
    const previous = logs[1]?.doneAt ?? null;

    db.update(schedules)
      .set({
        lastDoneAt: previous,
        snoozedUntil: null,
        snoozeSource: null,
        scheduleVersion: sql`${schedules.scheduleVersion} + 1`,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schedules.id, scheduleId))
      .run();
    return { ok: true, tankId: s.tankId };
  } catch (err) {
    console.error("[undoLastDoneCore]", err);
    return failure("undo.failed", "Could not undo");
  }
}

// ==================== Shared write cores -- Water tests (edit/delete) ====================

export const waterTestUpdateSchema = waterTestInputSchema.extend({ id: z.number().int().positive() });

export function updateWaterTestCore(input: unknown): WriteResultWithTank {
  const parsed = waterTestUpdateSchema.safeParse(input);
  if (!parsed.success) return failure("validation", firstZodError(parsed.error), { detail: firstZodError(parsed.error) });
  const tank = db.select().from(tanks).where(and(eq(tanks.id, parsed.data.tankId), isNull(tanks.deletedAt))).get();
  if (!tank) return failure("tank.notFound", "Tank not found");
  const [clean, vErr] = validateWaterValues(parsed.data.values, tank.waterType);
  if (vErr || !clean) return failure("values.invalid", vErr ?? "Invalid values", { detail: vErr ?? "" });
  try {
    const existing = db.select().from(waterTests).where(eq(waterTests.id, parsed.data.id)).get();
    if (!existing) return failure("waterTest.notFound", "Water test not found");
    db.update(waterTests)
      .set({ measuredAt: parsed.data.measuredAt, values: clean, note: parsed.data.note ?? null })
      .where(eq(waterTests.id, parsed.data.id))
      .run();
    return { ok: true, tankId: parsed.data.tankId };
  } catch (err) {
    console.error("[updateWaterTestCore]", err);
    return failure("waterTest.updateFailed", "Could not update water test");
  }
}

export function deleteWaterTestCore(id: number): WriteResultWithTank {
  try {
    const existing = db.select().from(waterTests).where(eq(waterTests.id, id)).get();
    if (!existing) return failure("waterTest.notFound", "Water test not found");
    db.delete(waterTests).where(eq(waterTests.id, id)).run();
    return { ok: true, tankId: existing.tankId };
  } catch (err) {
    console.error("[deleteWaterTestCore]", err);
    return failure("waterTest.deleteFailed", "Could not delete water test");
  }
}

// ==================== Generic action log (v1 REST API -- the display's write path) ====================
//
// `logActionCore` is the API's generic event sink -- but only for the
// standard-events catalog (action-types.ts), same as schedules. Feeding is
// deliberately rejected here -- it is a daily COUNTER (feed_logs, unique per
// tankId+day, cycling 0 -> 1 -> 2 -> 0), not a timestamped maintenance_logs
// row, and accepting both would give AquaMon two disagreeing answers to
// "when was this tank last fed".

export const logActionSchema = z.object({
  tankId: z.number().int().positive(),
  // Validated against the standard-events catalog in logActionCore (not a
  // zod enum here) so the "feed" rejection can carry its own friendlier
  // message pointing at /tanks/{id}/feedings. Allowed values: LOGGABLE_ACTION_TYPES
  // in @/lib/domain/action-types (water_change, fertilize, water_test,
  // substrate_vacuum, filter_change, filter_clean, water_top_up, glass_clean, plant_trim).
  actionType: z.string().trim().min(1).max(40).describe("One of the standard-events catalog's loggable types (see LOGGABLE_ACTION_TYPES) -- everything except 'feed', which is a daily counter logged via POST /tanks/{id}/feedings"),
  doneAt: z.string().datetime().optional(),
  note: z.string().trim().max(500).optional().nullable(),
  // issue: standard-events catalog -- structured details, same shape as a
  // schedule's detailData (rendered to `details` via formatDetailData).
  // Omitted -> the log inherits the matching active plan's details, if any.
  detailData: z.record(z.string(), z.unknown()).optional().nullable().describe("Structured details, same shapes as a schedule's detailData (percent/liters/nutrients/foods). Omitted: inherits the matching active plan's details, if any."),
  // default true: a logged action marks its matching active plan done too.
  // Set false to record history only (e.g. a backdated note) without
  // touching the schedule's due date.
  applyToSchedule: z.boolean().optional(),
});

export function logActionCore(input: unknown): WriteResultWithTank {
  const parsed = logActionSchema.safeParse(input);
  if (!parsed.success) return failure("validation", firstZodError(parsed.error), { detail: firstZodError(parsed.error) });
  const { actionType } = parsed.data;
  if (actionType === "feed") {
    return failure(
      "log.feedIsCounter",
      "Feeding is tracked as a daily count, not a logged action -- use POST /api/v1/tanks/{id}/feedings instead",
    );
  }
  if (!(LOGGABLE_ACTION_TYPES as readonly string[]).includes(actionType)) {
    return failure("log.notLoggable", `actionType must be one of: ${LOGGABLE_ACTION_TYPES.join(", ")}`, { types: LOGGABLE_ACTION_TYPES.join(", ") });
  }
  const tank = db.select().from(tanks).where(and(eq(tanks.id, parsed.data.tankId), isNull(tanks.deletedAt))).get();
  if (!tank) return failure("tank.notFound", "Tank not found");
  try {
    const doneAt = parsed.data.doneAt ?? new Date().toISOString();
    const active = db
      .select()
      .from(schedules)
      .where(and(eq(schedules.tankId, parsed.data.tankId), eq(schedules.actionType, actionType), eq(schedules.active, true)))
      .get();
    // Structured details: caller-supplied detailData renders its own `details`
    // line; otherwise inherit the matching plan's details/detailData (this is
    // what makes a bare `{ actionType: "fertilize" }` log carry the same
    // "Fe 10 ml · K 5 ml" line as ticking the plan off in the dashboard).
    const detailData = parsed.data.detailData !== undefined ? parsed.data.detailData : (active?.detailData ?? null);
    const details =
      parsed.data.detailData !== undefined
        ? formatDetailData(actionType, parsed.data.detailData, tank.volumeL) || null
        : (active?.details ?? null);
    addMaintenanceLog({
      tankId: parsed.data.tankId,
      actionType,
      doneAt,
      note: parsed.data.note ?? undefined,
      source: "api",
      scheduleId: active?.id ?? null,
      details,
      detailData,
    });
    if (parsed.data.applyToSchedule !== false && active) {
      // never pull lastDoneAt BACKWARD -- a backdated log must not make an
      // already-done task look overdue again
      const nextLastDoneAt = !active.lastDoneAt || doneAt > active.lastDoneAt ? doneAt : active.lastDoneAt;
      db.update(schedules)
        .set({
          lastDoneAt: nextLastDoneAt,
          snoozedUntil: null,
          snoozeSource: null,
          scheduleVersion: active.scheduleVersion + 1,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schedules.id, active.id))
        .run();
    }
    return { ok: true, tankId: parsed.data.tankId };
  } catch (err) {
    console.error("[logActionCore]", err);
    return failure("log.failed", "Could not log action");
  }
}

/** Most recent completion per actionType for a tank -- the source for a display's status view. */
export type LastAction = { actionType: string; lastDoneAt: string };

export function lastActionsForTank(tankId: number): LastAction[] {
  return db
    .select({
      actionType: maintenanceLogs.actionType,
      lastDoneAt: sql<string>`max(${maintenanceLogs.doneAt})`,
    })
    .from(maintenanceLogs)
    .where(eq(maintenanceLogs.tankId, tankId))
    .groupBy(maintenanceLogs.actionType)
    .all();
}

/** Most recent feed_logs row for a tank (any day), independent of "today". */
export function lastFeed(tankId: number): FeedLog | undefined {
  return db.select().from(feedLogs).where(eq(feedLogs.tankId, tankId)).orderBy(desc(feedLogs.day)).limit(1).get();
}
