"use server";

import { revalidatePath } from "next/cache";
import type { TankInput, ScheduleInput } from "@/lib/schemas";
import { today as todayStr } from "@/lib/domain/dates";
import { feedDayError } from "@/lib/domain/feed-window";
import { failure, type ErrorCode, type ErrorVars } from "@/lib/domain/errors";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  /**
   * `error` stays English (it is what the REST API serves); `code`/`vars` are
   * what the UI renders through the catalogs — see lib/domain/errors.ts.
   */
  | { ok: false; error: string; code: ErrorCode; vars?: ErrorVars; fieldErrors?: Record<string, string> };

// ==================== Tanks ====================
//
// Write logic lives in src/lib/repo.ts (*Core functions) so a non-Next
// client (the v1 REST API, an ESPHome display) can reach the same
// validation and side effects a Server Action gets. This layer only adds
// what a route handler cannot do itself: revalidatePath and the AI
// plan-review trigger.

export async function createTank(input: TankInput, photoPath?: string | null): Promise<ActionResult<{ id: number }>> {
  try {
    const { createTankCore } = await import("@/lib/repo");
    const res = createTankCore(input, photoPath);
    if (!res.ok) return res;
    revalidatePath("/tanks");
    revalidatePath("/");
    return { ok: true, data: { id: res.id } };
  } catch (err) {
    console.error("[createTank]", err);
    return failure("tank.createFailed", "Could not create tank");
  }
}

export async function updateTank(id: number, input: TankInput, photoPath?: string | null): Promise<ActionResult> {
  try {
    const { updateTankCore } = await import("@/lib/repo");
    const res = updateTankCore(id, input, photoPath);
    if (!res.ok) return res;
    revalidatePath(`/tanks/${id}`);
    revalidatePath("/tanks");
    revalidatePath("/");
    revalidatePath("/coach");
    // plan review trigger: did master data that affects the plan change?
    if (res.masterChanged) {
      const { requestPlanReview } = await import("@/lib/ai/plan-review");
      requestPlanReview("tank_change");
    }
    return { ok: true };
  } catch (err) {
    console.error("[updateTank]", err);
    return failure("tank.updateFailed", "Could not update tank");
  }
}

export async function deleteTank(id: number): Promise<ActionResult> {
  try {
    const { deleteTankCore } = await import("@/lib/repo");
    const res = deleteTankCore(id);
    if (!res.ok) return res;
    revalidatePath("/tanks");
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    console.error("[deleteTank]", err);
    return failure("tank.deleteFailed", "Could not delete tank");
  }
}

// ==================== Schedules ====================

export async function createSchedule(input: ScheduleInput): Promise<ActionResult<{ id: number }>> {
  try {
    const { createScheduleCore } = await import("@/lib/repo");
    const res = createScheduleCore(input);
    if (!res.ok) return res;
    revalidatePath("/");
    revalidatePath(`/tanks/${input.tankId}`);
    return { ok: true, data: { id: res.id } };
  } catch (err) {
    console.error("[createSchedule]", err);
    return failure("schedule.createFailed", "Could not create schedule");
  }
}

export async function updateSchedule(id: number, input: ScheduleInput): Promise<ActionResult> {
  try {
    const { updateScheduleCore } = await import("@/lib/repo");
    const res = updateScheduleCore(id, input);
    if (!res.ok) return res;
    revalidatePath("/");
    revalidatePath(`/tanks/${input.tankId}`);
    return { ok: true };
  } catch (err) {
    console.error("[updateSchedule]", err);
    return failure("schedule.updateFailed", "Could not update schedule");
  }
}

/**
 * Hard-delete a schedule (owner request: quick delete in tank view).
 * Safe: nothing references schedules.id — maintenance logs hang off
 * (tankId, actionType), history stays intact. Confirm lives in the UI.
 */
export async function deleteSchedule(id: number): Promise<ActionResult> {
  try {
    const { deleteScheduleCore } = await import("@/lib/repo");
    const res = deleteScheduleCore(id);
    if (!res.ok) return res;
    revalidatePath("/");
    revalidatePath("/calendar");
    revalidatePath(`/tanks/${res.tankId}`);
    return { ok: true };
  } catch (err) {
    console.error("[deleteSchedule]", err);
    return failure("schedule.deleteFailed", "Could not delete schedule");
  }
}

export async function setScheduleActive(id: number, active: boolean): Promise<ActionResult> {
  try {
    const { setScheduleActiveCore } = await import("@/lib/repo");
    const res = setScheduleActiveCore(id, active);
    if (!res.ok) return res;
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    console.error("[setScheduleActive]", err);
    return failure("schedule.updateFailed", "Could not update schedule");
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
    return failure("schedule.doneFailed", "Could not mark done");
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
    return failure("snooze.failed", "Could not snooze");
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
    return failure("waterTest.saveFailed", "Could not save water test");
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
    return failure("feed.failed", "Could not mark fed");
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
    return failure("token.rotateFailed", "Could not rotate token");
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
    return failure("token.rotateFailed", "Could not rotate token");
  }
}

// ==================== API token (v1 REST API) ====================

/** Rotates the REST API bearer token — every configured client (ESPHome display, etc.) loses access immediately. */
export async function rotateApiTokenAction(): Promise<ActionResult<{ token: string }>> {
  try {
    const { rotateApiToken } = await import("@/lib/api-token");
    const token = rotateApiToken();
    revalidatePath("/more");
    return { ok: true, data: { token } };
  } catch (err) {
    console.error("[rotateApiTokenAction]", err);
    return failure("token.rotateFailed", "Could not rotate token");
  }
}

// ==================== Undo done (issue #34) ====================

export async function undoLastDone(scheduleId: number): Promise<ActionResult> {
  try {
    const { undoLastDoneCore } = await import("@/lib/repo");
    const res = undoLastDoneCore(scheduleId);
    if (!res.ok) return res;
    revalidatePath("/");
    revalidatePath(`/tanks/${res.tankId}`);
    return { ok: true };
  } catch (err) {
    console.error("[undoLastDone]", err);
    return failure("undo.failed", "Could not undo");
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
    return failure("feed.failed", "Could not adjust feeding");
  }
}

/** Same stepper, but on a PAST day within the 30-day backfill window. */
export async function adjustFeedOn(
  tankId: number,
  day: string,
  delta: 1 | -1,
): Promise<ActionResult<{ timesFed: number }>> {
  const dayErr = feedDayError(day);
  if (dayErr) return failure(dayErr.code, dayErr.error);
  try {
    const { adjustFeedCore } = await import("@/lib/repo");
    const res = adjustFeedCore(tankId, day, delta);
    revalidatePath("/");
    return { ok: true, data: { timesFed: res.timesFed } };
  } catch (err) {
    console.error("[adjustFeedOn]", err);
    return failure("feed.failed", "Could not adjust feeding");
  }
}

// ==================== Water test edit/delete (issue #35) ====================

export async function updateWaterTest(input: unknown): Promise<ActionResult> {
  try {
    const { updateWaterTestCore } = await import("@/lib/repo");
    const res = updateWaterTestCore(input);
    if (!res.ok) return res;
    revalidatePath("/");
    revalidatePath(`/tanks/${res.tankId}`);
    revalidatePath("/coach");
    const { requestPlanReview } = await import("@/lib/ai/plan-review");
    requestPlanReview("water_test");
    return { ok: true };
  } catch (err) {
    console.error("[updateWaterTest]", err);
    return failure("waterTest.updateFailed", "Could not update water test");
  }
}

export async function deleteWaterTest(id: number): Promise<ActionResult> {
  try {
    const { deleteWaterTestCore } = await import("@/lib/repo");
    const res = deleteWaterTestCore(id);
    if (!res.ok) return res;
    revalidatePath("/");
    revalidatePath(`/tanks/${res.tankId}`);
    return { ok: true };
  } catch (err) {
    console.error("[deleteWaterTest]", err);
    return failure("waterTest.deleteFailed", "Could not delete water test");
  }
}

// ==================== Global settings (issues #39/#40) ====================

export async function saveGlobalSettingsAction(input: unknown): Promise<ActionResult> {
  try {
    const { saveGlobalSettings } = await import("@/lib/settings");
    saveGlobalSettings(input);
    // "layout" scope, not just these two pages: the language lives in the ROOT
    // layout, so a switch has to repaint every route, not only /more and /.
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    console.error("[saveGlobalSettingsAction]", err);
    return failure("settings.invalid", "Invalid settings");
  }
}
