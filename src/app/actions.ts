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

/**
 * The feeding plan's UI write path (docs/plan-fuetterungsplan.md) — a
 * tank-profile edit in spirit, so it revalidates the same surfaces and fires
 * the same plan-review trigger updateTank does (the coach's context includes
 * the plan; it may have something to say about the new one).
 */
export async function setTankFeedingPlan(tankId: number, plan: string | null): Promise<ActionResult> {
  try {
    const { setTankFeedingPlanCore } = await import("@/lib/repo");
    const res = setTankFeedingPlanCore(tankId, plan);
    if (!res.ok) return res;
    revalidatePath(`/tanks/${tankId}`);
    revalidatePath("/tanks");
    revalidatePath("/coach");
    const { requestPlanReview } = await import("@/lib/ai/plan-review");
    requestPlanReview("tank_change");
    return { ok: true };
  } catch (err) {
    console.error("[setTankFeedingPlan]", err);
    return failure("tank.updateFailed", "Could not save the feeding plan");
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

/**
 * Returns the new row's `id`/`measuredAt` so the form can keep editing THIS
 * measurement (issue: every save started a new water test instead of
 * correcting the one just entered).
 */
export async function logWaterTest(input: unknown): Promise<ActionResult<{ id: number; measuredAt: string }>> {
  try {
    const { logWaterTestCore } = await import("@/lib/repo");
    const res = logWaterTestCore(input);
    if (!res.ok) return res;
    revalidatePath("/");
    revalidatePath(`/tanks/${res.tankId}`);
    revalidatePath("/coach");
    const { requestPlanReview } = await import("@/lib/ai/plan-review");
    requestPlanReview("water_test");
    return { ok: true, data: { id: res.id, measuredAt: res.measuredAt } };
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

// ==================== Products (inventory) ====================
//
// A new or changed fertilizer can make a different care plan the right one,
// so every write here asks for a plan review -- the same trigger a tank's
// master data fires. Reason stays "tank_change": a separate reason would drag
// the state machine, the badge copy and both catalogs along without telling
// the user anything new.

export async function createProduct(input: unknown): Promise<ActionResult<{ id: number }>> {
  try {
    const { createProductCore } = await import("@/lib/repo");
    const res = createProductCore(input);
    if (!res.ok) return res;
    revalidatePath("/inventory");
    revalidatePath("/tanks");
    revalidatePath("/coach");
    const { requestPlanReview } = await import("@/lib/ai/plan-review");
    requestPlanReview("tank_change");
    return { ok: true, data: { id: res.id } };
  } catch (err) {
    console.error("[createProduct]", err);
    return failure("product.createFailed", "Could not create product");
  }
}

/** `renamedPlans` = how many active plans had their food key re-keyed (repo.ts). */
export async function updateProduct(id: number, input: unknown): Promise<ActionResult<{ renamedPlans: number }>> {
  try {
    const { updateProductCore } = await import("@/lib/repo");
    const res = updateProductCore(id, input);
    if (!res.ok) return res;
    revalidatePath("/inventory");
    revalidatePath("/tanks");
    revalidatePath("/coach");
    const { requestPlanReview } = await import("@/lib/ai/plan-review");
    requestPlanReview("tank_change");
    return { ok: true, data: { renamedPlans: res.renamedPlans } };
  } catch (err) {
    console.error("[updateProduct]", err);
    return failure("product.updateFailed", "Could not update product");
  }
}

export async function deleteProduct(id: number): Promise<ActionResult> {
  try {
    const { deleteProductCore } = await import("@/lib/repo");
    const res = deleteProductCore(id);
    if (!res.ok) return res;
    revalidatePath("/inventory");
    revalidatePath("/tanks");
    revalidatePath("/coach");
    return { ok: true };
  } catch (err) {
    console.error("[deleteProduct]", err);
    return failure("product.deleteFailed", "Could not delete product");
  }
}

/**
 * "Used up" (docs/plan-produkt-archiv.md): off the shelf and out of the coach
 * context. Returns the plans that just lost something so the UI can OFFER
 * updates — deliberately no automatic AI review: the offer is a link, and the
 * owner decides whether to spend a call.
 */
export async function archiveProduct(
  id: number,
): Promise<ActionResult<{ affected: { schedules: unknown[]; feedingPlans: unknown[] } }>> {
  try {
    const { archiveProductCore } = await import("@/lib/repo");
    const res = archiveProductCore(id);
    if (!res.ok) return res;
    revalidatePath("/inventory");
    revalidatePath("/tanks");
    revalidatePath("/");
    revalidatePath("/coach");
    return { ok: true, data: { affected: res.affected } };
  } catch (err) {
    console.error("[archiveProduct]", err);
    return failure("product.updateFailed", "Could not archive product");
  }
}

export async function unarchiveProduct(id: number): Promise<ActionResult> {
  try {
    const { unarchiveProductCore } = await import("@/lib/repo");
    const res = unarchiveProductCore(id);
    if (!res.ok) return res;
    revalidatePath("/inventory");
    revalidatePath("/tanks");
    revalidatePath("/coach");
    return { ok: true };
  } catch (err) {
    console.error("[unarchiveProduct]", err);
    return failure("product.updateFailed", "Could not restore product");
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

// ==================== Coach prompt overrides (docs/plan-prompt-anpassung.md) ====================

/**
 * Save one prompt override (empty/null = reset to default). Validation is the
 * SAME gate the test endpoint uses — what was tested is exactly what saves.
 * A changed suggestions prompt also drops today's chip cache so the chips
 * regenerate under the new prompt instead of showing the old one's output.
 */
export async function savePromptAction(id: string, text: string | null): Promise<ActionResult> {
  try {
    const { PROMPT_IDS, validatePromptText, savePromptOverride } = await import("@/lib/ai/prompts");
    if (!PROMPT_IDS.includes(id as never)) return failure("prompt.invalid", "Unknown prompt");
    const promptId = id as "coach" | "suggestions" | "planReview" | "feedingPlanDraft";
    if (text !== null && text.trim() !== "") {
      const check = validatePromptText(promptId, text);
      if (!check.ok) return failure("prompt.invalid", check.error, { detail: check.error });
    }
    savePromptOverride(promptId, text);
    if (promptId === "suggestions") {
      const { clearDailySuggestions } = await import("@/lib/settings");
      clearDailySuggestions();
    }
    revalidatePath("/more");
    if (promptId === "coach") revalidatePath("/coach");
    return { ok: true };
  } catch (err) {
    console.error("[savePromptAction]", err);
    return failure("prompt.saveFailed", "Could not save the prompt");
  }
}
