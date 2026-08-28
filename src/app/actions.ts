"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { tanks, schedules, maintenanceLogs, waterTests } from "@/lib/db/schema";
import {
  tankInputSchema,
  scheduleInputSchema,
  waterTestInputSchema,
  type TankInput,
  type ScheduleInput,
} from "@/lib/schemas";
import { today as todayStr } from "@/lib/domain/dates";
import { feedDayError } from "@/lib/domain/feed-window";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/** Issue #27: consistent liveness check — soft-deleted tanks are invisible but FK-valid. */
function assertLiveTank(tankId: number): boolean {
  const t = db.select().from(tanks).where(and(eq(tanks.id, tankId), isNull(tanks.deletedAt))).get();
  return !!t;
}

function zodFail(e: { flatten: () => { formErrors: string[]; fieldErrors: Record<string, string[]> } }): ActionResult {
  const f = e.flatten();
  return {
    ok: false,
    error: f.formErrors[0] ?? "Validation failed",
    fieldErrors: Object.fromEntries(
      Object.entries(f.fieldErrors).map(([k, v]) => [k, (v as string[])?.[0] ?? "invalid"]),
    ),
  };
}

// ==================== Tanks ====================

export async function createTank(input: TankInput, photoPath?: string | null): Promise<ActionResult<{ id: number }>> {
  const parsed = tankInputSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
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
    revalidatePath("/tanks");
    revalidatePath("/");
    return { ok: true, data: { id: row.id } };
  } catch (err) {
    console.error("[createTank]", err);
    return { ok: false, error: "Could not create tank" };
  }
}

export async function updateTank(id: number, input: TankInput, photoPath?: string | null): Promise<ActionResult> {
  const parsed = tankInputSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
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
    revalidatePath(`/tanks/${id}`);
    revalidatePath("/tanks");
    revalidatePath("/");
    revalidatePath("/coach");

    // plan review trigger: did master data that affects the plan change?
    if (before) {
      const masterChanged =
        before.volumeL !== parsed.data.volumeL ||
        JSON.stringify(before.fish) !== JSON.stringify(parsed.data.fish) ||
        JSON.stringify(before.plants) !== JSON.stringify(parsed.data.plants) ||
        JSON.stringify(before.foods ?? []) !== JSON.stringify(parsed.data.foods ?? []) ||
        before.hasCo2 !== parsed.data.hasCo2 ||
        before.hasHeater !== parsed.data.hasHeater ||
        before.hasFilter !== parsed.data.hasFilter ||
        before.filterType !== (parsed.data.filterType ?? null);
      if (masterChanged) {
        const { requestPlanReview } = await import("@/lib/ai/plan-review");
        requestPlanReview("tank_change");
      }
    }
    return { ok: true };
  } catch (err) {
    console.error("[updateTank]", err);
    return { ok: false, error: "Could not update tank" };
  }
}

export async function deleteTank(id: number): Promise<ActionResult> {
  try {
    // soft delete (never row-delete: logs/tests reference tanks)
    db.update(tanks).set({ deletedAt: new Date().toISOString() }).where(eq(tanks.id, id)).run();
    db.update(schedules).set({ active: false }).where(eq(schedules.tankId, id)).run();
    revalidatePath("/tanks");
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    console.error("[deleteTank]", err);
    return { ok: false, error: "Could not delete tank" };
  }
}

// ==================== Schedules ====================

export async function createSchedule(input: ScheduleInput): Promise<ActionResult<{ id: number }>> {
  const parsed = scheduleInputSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  if (!assertLiveTank(parsed.data.tankId)) return { ok: false, error: "Tank not found" };
  // issue #42: one plan per standard type per tank — duplicates would overlap
  const { isStandardPlanType } = await import("@/lib/domain/plan-structure");
  if (isStandardPlanType(parsed.data.actionType)) {
    const existing = db
      .select({ id: schedules.id })
      .from(schedules)
      .where(and(eq(schedules.tankId, parsed.data.tankId), eq(schedules.actionType, parsed.data.actionType), eq(schedules.active, true)))
      .get();
    if (existing) {
      return { ok: false, error: `This tank already has a ${parsed.data.actionType.replace(/_/g, " ")} plan (one per type) — edit it instead` };
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
    revalidatePath("/");
    revalidatePath(`/tanks/${parsed.data.tankId}`);
    return { ok: true, data: { id: row.id } };
  } catch (err) {
    console.error("[createSchedule]", err);
    return { ok: false, error: "Could not create schedule" };
  }
}

export async function updateSchedule(id: number, input: ScheduleInput): Promise<ActionResult> {
  const parsed = scheduleInputSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  if (!assertLiveTank(parsed.data.tankId)) return { ok: false, error: "Tank not found" };
  // issue #42: renaming to a standard type another active plan already holds → block
  const { isStandardPlanType } = await import("@/lib/domain/plan-structure");
  if (isStandardPlanType(parsed.data.actionType)) {
    const clash = db
      .select({ id: schedules.id })
      .from(schedules)
      .where(and(eq(schedules.tankId, parsed.data.tankId), eq(schedules.actionType, parsed.data.actionType), eq(schedules.active, true)))
      .get();
    if (clash && clash.id !== id) {
      return { ok: false, error: `This tank already has a ${parsed.data.actionType.replace(/_/g, " ")} plan` };
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
        // Issue #27: atomic increment — no read-modify-write, no silent ?? 0
        scheduleVersion: sql`${schedules.scheduleVersion} + 1`,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schedules.id, id))
      .run();
    revalidatePath("/");
    revalidatePath(`/tanks/${parsed.data.tankId}`);
    return { ok: true };
  } catch (err) {
    console.error("[updateSchedule]", err);
    return { ok: false, error: "Could not update schedule" };
  }
}

/**
 * Hard-delete a schedule (owner request: quick delete in tank view).
 * Safe: nothing references schedules.id — maintenance logs hang off
 * (tankId, actionType), history stays intact. Confirm lives in the UI.
 */
export async function deleteSchedule(id: number): Promise<ActionResult> {
  try {
    const s = db.select().from(schedules).where(eq(schedules.id, id)).get();
    if (!s) return { ok: false, error: "Schedule not found" };
    db.delete(schedules).where(eq(schedules.id, id)).run();
    revalidatePath("/");
    revalidatePath("/calendar");
    revalidatePath(`/tanks/${s.tankId}`);
    return { ok: true };
  } catch (err) {
    console.error("[deleteSchedule]", err);
    return { ok: false, error: "Could not delete schedule" };
  }
}

export async function setScheduleActive(id: number, active: boolean): Promise<ActionResult> {
  try {
    db.update(schedules).set({ active, updatedAt: new Date().toISOString() }).where(eq(schedules.id, id)).run();
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    console.error("[setScheduleActive]", err);
    return { ok: false, error: "Could not update schedule" };
  }
}

// ==================== Tasks (done / snooze) ====================

export async function markDone(scheduleId: number, note?: string): Promise<ActionResult> {
  try {
    const { markScheduleDoneCore } = await import("@/lib/repo");
    const res = markScheduleDoneCore(scheduleId, note);
    if (!res.ok) return res;
    revalidatePath("/");
    revalidatePath(`/tanks/${res.tankId}`);
    return { ok: true };
  } catch (err) {
    console.error("[markDone]", err);
    return { ok: false, error: "Could not mark done" };
  }
}

export async function snooze(scheduleId: number, until: string): Promise<ActionResult> {
  try {
    const { snoozeScheduleCore } = await import("@/lib/repo");
    const res = snoozeScheduleCore(scheduleId, until);
    if (!res.ok) return res;
    revalidatePath("/");
    revalidatePath(`/tanks/${res.tankId}`);
    return { ok: true };
  } catch (err) {
    console.error("[snooze]", err);
    return { ok: false, error: "Could not snooze" };
  }
}

// ==================== Water tests ====================

export async function logWaterTest(input: unknown): Promise<ActionResult> {
  try {
    const { logWaterTestCore } = await import("@/lib/repo");
    const res = logWaterTestCore(input);
    if (!res.ok) return res;
    revalidatePath("/");
    revalidatePath(`/tanks/${res.tankId}`);
    revalidatePath("/coach");
    const { requestPlanReview } = await import("@/lib/ai/plan-review");
    requestPlanReview("water_test");
    return { ok: true };
  } catch (err) {
    console.error("[logWaterTest]", err);
    return { ok: false, error: "Could not save water test" };
  }
}

// ==================== Feeding (daily habit) ====================

export async function markFedToday(tankId: number): Promise<ActionResult> {
  // Issue #25: NO caller-supplied timezone — AQUAMAN_TIMEZONE governs "today".
  try {
    const { markFed } = await import("@/lib/repo");
    const day = todayStr();
    markFed(tankId, day);
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    console.error("[markFedToday]", err);
    return { ok: false, error: "Could not mark fed" };
  }
}

// ==================== ICS feed token (Phase 3) ====================

/** Rotates the ICS feed token — the old subscribe URL stops working immediately. */
export async function rotateIcsTokenAction(): Promise<ActionResult<{ token: string }>> {
  try {
    const { rotateIcsToken } = await import("@/lib/ics-token");
    const token = rotateIcsToken();
    revalidatePath("/more");
    return { ok: true, data: { token } };
  } catch (err) {
    console.error("[rotateIcsTokenAction]", err);
    return { ok: false, error: "Could not rotate token" };
  }
}

// ==================== MCP token (product v1.1) ====================

/** Rotates the MCP bearer token — every configured agent loses access immediately. */
export async function rotateMcpTokenAction(): Promise<ActionResult<{ token: string }>> {
  try {
    const { rotateMcpToken } = await import("@/lib/mcp-token");
    const token = rotateMcpToken();
    revalidatePath("/more");
    return { ok: true, data: { token } };
  } catch (err) {
    console.error("[rotateMcpTokenAction]", err);
    return { ok: false, error: "Could not rotate token" };
  }
}


// ==================== Undo done (issue #34) ====================

/**
 * Undo a wrongly marked-done task: deletes the most recent maintenance-log
 * row for this schedule and restores the PREVIOUS lastDoneAt (the second-newest
 * log for this tank+action, or null when the undone one was the first).
 * scheduleVersion bumps so ICS consumers see the change.
 */
export async function undoLastDone(scheduleId: number): Promise<ActionResult> {
  try {
    const s = db.select().from(schedules).where(eq(schedules.id, scheduleId)).get();
    if (!s) return { ok: false, error: "Schedule not found" };
    if (!s.lastDoneAt) return { ok: false, error: "Nothing to undo" };

    const logs = db
      .select()
      .from(maintenanceLogs)
      .where(and(eq(maintenanceLogs.tankId, s.tankId), eq(maintenanceLogs.actionType, s.actionType)))
      .orderBy(desc(maintenanceLogs.doneAt))
      .limit(2)
      .all();

    if (logs.length === 0) return { ok: false, error: "Nothing to undo" };

    db.delete(maintenanceLogs).where(eq(maintenanceLogs.id, logs[0].id)).run();

    // restore: previous completion if there was one, else null (never done)
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

    revalidatePath("/");
    revalidatePath(`/tanks/${s.tankId}`);
    return { ok: true };
  } catch (err) {
    console.error("[undoLastDone]", err);
    return { ok: false, error: "Could not undo" };
  }
}

// ==================== Feed adjust ± (issue #32, day backfill owner request) ====================
//
// The backfill window itself lives in @/lib/domain/feed-window so the dashboard's
// day navigation and this validation can never disagree about which days are
// editable.

export async function adjustFeedToday(tankId: number, delta: 1 | -1): Promise<ActionResult<{ timesFed: number }>> {
  // Issue #25: NO caller-supplied timezone — AQUAMAN_TIMEZONE governs "today".
  try {
    const { adjustFeedCore } = await import("@/lib/repo");
    const res = adjustFeedCore(tankId, todayStr(), delta);
    revalidatePath("/");
    return { ok: true, data: { timesFed: res.timesFed } };
  } catch (err) {
    console.error("[adjustFeedToday]", err);
    return { ok: false, error: "Could not adjust feeding" };
  }
}

/** Same stepper, but on a PAST day within the 30-day backfill window. */
export async function adjustFeedOn(
  tankId: number,
  day: string,
  delta: 1 | -1,
): Promise<ActionResult<{ timesFed: number }>> {
  const dayErr = feedDayError(day);
  if (dayErr) return { ok: false, error: dayErr };
  try {
    const { adjustFeedCore } = await import("@/lib/repo");
    const res = adjustFeedCore(tankId, day, delta);
    revalidatePath("/");
    return { ok: true, data: { timesFed: res.timesFed } };
  } catch (err) {
    console.error("[adjustFeedOn]", err);
    return { ok: false, error: "Could not adjust feeding" };
  }
}

// ==================== Water test edit/delete (issue #35) ====================

const waterTestUpdateSchema = waterTestInputSchema.extend({ id: z.number().int().positive() });

export async function updateWaterTest(input: unknown): Promise<ActionResult> {
  const parsed = waterTestUpdateSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  const tank = db.select().from(tanks).where(and(eq(tanks.id, parsed.data.tankId), isNull(tanks.deletedAt))).get();
  if (!tank) return { ok: false, error: "Tank not found" };
  const { validateWaterValues } = await import("@/lib/schemas");
  const [clean, vErr] = validateWaterValues(parsed.data.values, tank.waterType);
  if (vErr || !clean) return { ok: false, error: vErr ?? "Invalid values" };
  try {
    const existing = db.select().from(waterTests).where(eq(waterTests.id, parsed.data.id)).get();
    if (!existing) return { ok: false, error: "Water test not found" };
    db.update(waterTests)
      .set({ measuredAt: parsed.data.measuredAt, values: clean, note: parsed.data.note ?? null })
      .where(eq(waterTests.id, parsed.data.id))
      .run();
    revalidatePath("/");
    revalidatePath(`/tanks/${parsed.data.tankId}`);
    revalidatePath("/coach");
    const { requestPlanReview } = await import("@/lib/ai/plan-review");
    requestPlanReview("water_test");
    return { ok: true };
  } catch (err) {
    console.error("[updateWaterTest]", err);
    return { ok: false, error: "Could not update water test" };
  }
}

export async function deleteWaterTest(id: number): Promise<ActionResult> {
  try {
    const existing = db.select().from(waterTests).where(eq(waterTests.id, id)).get();
    if (!existing) return { ok: false, error: "Water test not found" };
    db.delete(waterTests).where(eq(waterTests.id, id)).run();
    revalidatePath("/");
    revalidatePath(`/tanks/${existing.tankId}`);
    return { ok: true };
  } catch (err) {
    console.error("[deleteWaterTest]", err);
    return { ok: false, error: "Could not delete water test" };
  }
}


// ==================== Global settings (issues #39/#40) ====================

export async function saveGlobalSettingsAction(input: unknown): Promise<ActionResult> {
  try {
    const { saveGlobalSettings } = await import("@/lib/settings");
    saveGlobalSettings(input);
    revalidatePath("/more");
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    console.error("[saveGlobalSettingsAction]", err);
    return { ok: false, error: "Invalid settings" };
  }
}
