"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
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
import { addDays, today as todayStr } from "@/lib/domain/dates";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

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
        scheduleVersion: (db.select().from(schedules).where(eq(schedules.id, id)).get()?.scheduleVersion ?? 0) + 1,
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
  try {
    addWaterTest({
      tankId: parsed.data.tankId,
      measuredAt: parsed.data.measuredAt,
      values: parsed.data.values,
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

export async function markFedToday(tankId: number, tz?: string): Promise<ActionResult> {
  try {
    const { markFed } = await import("@/lib/repo");
    const day = todayStr(tz);
    markFed(tankId, day);
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    console.error("[markFedToday]", err);
    return { ok: false, error: "Could not mark fed" };
  }
}

// ==================== helpers for UI ====================

export async function quickSnoozeOptions(): Promise<{ label: string; date: string }[]> {
  const t = todayStr();
  return [
    { label: "Tomorrow", date: addDays(t, 1) },
    { label: "+3 days", date: addDays(t, 3) },
    { label: "+7 days", date: addDays(t, 7) },
  ];
}
