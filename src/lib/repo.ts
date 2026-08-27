import { db } from "@/lib/db";
import { tanks, schedules, maintenanceLogs, waterTests, feedLogs } from "@/lib/db/schema";
import { and, desc, eq, isNull, gte } from "drizzle-orm";
import type { Tank, Schedule, MaintenanceLog, WaterTest, FeedLog } from "@/lib/db/schema";
import { snoozeInputSchema, waterTestInputSchema, validateWaterValues } from "@/lib/schemas";
import { today } from "@/lib/domain/dates";

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

// ==================== Maintenance logs ====================

export function addMaintenanceLog(entry: {
  tankId: number;
  actionType: string;
  doneAt?: string;
  note?: string;
  source?: "user" | "ai_proposed" | "mcp";
}): MaintenanceLog {
  return db
    .insert(maintenanceLogs)
    .values({
      tankId: entry.tankId,
      actionType: entry.actionType,
      doneAt: entry.doneAt ?? new Date().toISOString(),
      note: entry.note,
      source: entry.source ?? "user",
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

// ==================== Shared write cores (Server Actions + MCP tools) ====================
//
// The v1.1 MCP write tools must behave EXACTLY like their in-app Server Action
// counterparts (same validation, same side effects) — so the core lives here
// and both callers wrap it. Cores return domain errors as values and only
// throw on unexpected DB failures; UI layers add revalidatePath/plan-review.

export type WriteResult = { ok: true } | { ok: false; error: string };
export type WriteResultWithTank = { ok: true; tankId: number } | { ok: false; error: string };

/** First zod form error, matching what zodFail() in actions.ts shows the user. */
function firstZodError(e: { flatten: () => { formErrors: string[] } }): string {
  return e.flatten().formErrors[0] ?? "Validation failed";
}

/**
 * "Done" core: maintenance-log row + lastDoneAt=now + clear snooze +
 * scheduleVersion bump (ICS SEQUENCE). `source` marks WHO did it — 'mcp'
 * keeps remote (OpenClaw) completions distinguishable in history.
 */
export function markScheduleDoneCore(
  scheduleId: number,
  note?: string,
  source: "user" | "ai_proposed" | "mcp" = "user",
): WriteResultWithTank {
  const s = db.select().from(schedules).where(eq(schedules.id, scheduleId)).get();
  if (!s) return { ok: false, error: "Schedule not found" };
  addMaintenanceLog({ tankId: s.tankId, actionType: s.actionType, note, source });
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
  if (!parsed.success) return { ok: false, error: firstZodError(parsed.error) };
  if (until < today()) return { ok: false, error: "Cannot snooze to a past date" };
  const s = db.select().from(schedules).where(eq(schedules.id, scheduleId)).get();
  if (!s) return { ok: false, error: "Schedule not found" };
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
  if (!parsed.success) return { ok: false, error: firstZodError(parsed.error) };
  const tank = db.select().from(tanks).where(and(eq(tanks.id, parsed.data.tankId), isNull(tanks.deletedAt))).get();
  if (!tank) return { ok: false, error: "Tank not found" };
  const [clean, vErr] = validateWaterValues(parsed.data.values, tank.waterType);
  if (vErr || !clean) return { ok: false, error: vErr ?? "Invalid values" };
  addWaterTest({
    tankId: parsed.data.tankId,
    measuredAt: parsed.data.measuredAt,
    values: clean,
    note: parsed.data.note ?? undefined,
  });
  return { ok: true, tankId: parsed.data.tankId };
}
