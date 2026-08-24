"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { tanks, schedules } from "@/lib/db/schema";
import {
  tankInputSchema,
  scheduleInputSchema,
  snoozeInputSchema,
  waterTestInputSchema,
  type TankInput,
  type ScheduleInput,
} from "@/lib/schemas";
import { addMaintenanceLog, addWaterTest } from "@/lib/repo";
import { today as todayStr } from "@/lib/domain/dates";

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
    db.update(tanks)
      .set({
        name: parsed.data.name,
        volumeL: parsed.data.volumeL,
        waterType: parsed.data.waterType,
        plants: parsed.data.plants,
        fish: parsed.data.fish,
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
    const s = db.select().from(schedules).where(eq(schedules.id, scheduleId)).get();
    if (!s) return { ok: false, error: "Schedule not found" };
    addMaintenanceLog({ tankId: s.tankId, actionType: s.actionType, note });
    // lastDoneAt = now (local day), clear snooze; scheduleVersion++ → ICS SEQUENCE
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
    revalidatePath("/");
    revalidatePath(`/tanks/${s.tankId}`);
    return { ok: true };
  } catch (err) {
    console.error("[markDone]", err);
    return { ok: false, error: "Could not mark done" };
  }
}

export async function snooze(scheduleId: number, until: string): Promise<ActionResult> {
  const parsed = snoozeInputSchema.safeParse({ scheduleId, until });
  if (!parsed.success) return zodFail(parsed.error);
  // Issue #27: a past snooze is meaningless (nextDue ignores it) — reject it
  const todayLocal = todayStr();
  if (until < todayLocal) {
    return { ok: false, error: "Cannot snooze to a past date", fieldErrors: { until: "must be today or later" } };
  }
  try {
    const s = db.select().from(schedules).where(eq(schedules.id, scheduleId)).get();
    if (!s) return { ok: false, error: "Schedule not found" };
    // User snooze date is taken LITERALLY — no weekday gridding (issue #6)
    db.update(schedules)
      .set({
        snoozedUntil: `${until}T00:00:00.000Z`,
        snoozeSource: "user",
        scheduleVersion: s.scheduleVersion + 1,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schedules.id, scheduleId))
      .run();
    revalidatePath("/");
    revalidatePath(`/tanks/${s.tankId}`);
    return { ok: true };
  } catch (err) {
    console.error("[snooze]", err);
    return { ok: false, error: "Could not snooze" };
  }
}

// ==================== Water tests ====================

export async function logWaterTest(input: unknown): Promise<ActionResult> {
  const parsed = waterTestInputSchema.safeParse(input);
  if (!parsed.success) return zodFail(parsed.error);
  const tank = db.select().from(tanks).where(and(eq(tanks.id, parsed.data.tankId), isNull(tanks.deletedAt))).get();
  if (!tank) return { ok: false, error: "Tank not found" };
  // Issue #24: whitelist keys + plausibility bounds per water type
  const { validateWaterValues } = await import("@/lib/schemas");
  const [clean, vErr] = validateWaterValues(parsed.data.values, tank.waterType);
  if (vErr || !clean) return { ok: false, error: vErr ?? "Invalid values" };
  try {
    addWaterTest({
      tankId: parsed.data.tankId,
      measuredAt: parsed.data.measuredAt,
      values: clean,
      note: parsed.data.note ?? undefined,
    });
    revalidatePath("/");
    revalidatePath(`/tanks/${parsed.data.tankId}`);
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
