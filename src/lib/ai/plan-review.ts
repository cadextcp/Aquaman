/**
 * Proactive plan review (issue-less, owner request):
 * After a tank master-data change (fish/plants/volume/equipment/foods) or a
 * water test, the app asks the coach whether the care plan should change.
 *
 * State machine (appSettings key "planReview.v1"):
 *   idle ──(trigger: tank_change|water_test)──▶ pending
 *   pending ──(POST start, AI on, budget ok)──▶ thinking ──▶ ready (count>0)
 *                                                    └─▶ idle (no changes / error / budget)
 *   ready ──(user saw it / clicked / dismissed)──▶ idle (reviewed)
 *
 * UI contract:
 *   - pending: nav badge auto-starts the review (one POST)
 *   - thinking: subtle pulse animation over the coach icon + info line in the coach tab
 *   - ready: notification badge with the number of recommended changes; coach tab
 *     shows the recommendations as clickable prompt chips (click → sends prompt,
 *     marks reviewed)
 */

import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { appSettings } from "@/lib/db/schema";
import { getLocale } from "@/lib/settings";

export const PLAN_REVIEW_KEY = "planReview.v1";

export type PlanReviewReason = "tank_change" | "water_test";

export type PlanReviewPrompt = { label: string; prompt: string };

export type PlanReviewState =
  | { state: "idle" }
  | { state: "pending"; reason: PlanReviewReason; since: string }
  | { state: "thinking"; reason: PlanReviewReason; since: string }
  | {
      state: "ready";
      reason: PlanReviewReason;
      since: string;
      summary: string;
      prompts: PlanReviewPrompt[];
      /** Language the coach wrote this in — see getPlanReviewState. */
      locale?: string;
    };

export const planReviewResultSchema = z.object({
  shouldChange: z.boolean(),
  summary: z.string().trim().max(400),
  prompts: z
    .array(z.object({ label: z.string().trim().min(3).max(80), prompt: z.string().trim().min(3).max(400) }))
    .max(5),
});

export function getPlanReviewState(): PlanReviewState {
  const row = db.select().from(appSettings).where(eq(appSettings.key, PLAN_REVIEW_KEY)).get();
  if (!row) return { state: "idle" };
  const v = row.value as Record<string, unknown>;
  if (v?.state === "pending" && (v.reason === "tank_change" || v.reason === "water_test")) {
    return { state: "pending", reason: v.reason, since: String(v.since ?? "") };
  }
  if (v?.state === "thinking" && (v.reason === "tank_change" || v.reason === "water_test")) {
    return { state: "thinking", reason: v.reason, since: String(v.since ?? "") };
  }
  if (v?.state === "ready" && Array.isArray(v.prompts)) {
    const parsed = planReviewResultSchema.safeParse({ shouldChange: true, summary: v.summary, prompts: v.prompts });
    // Summary and chips are coach OUTPUT, written in the language that was
    // active when the review ran. After a language switch they would sit in
    // the coach tab in the wrong language, so the result is dropped rather
    // than shown — and rather than burning a provider call to redo it: the
    // next data change triggers a fresh review anyway.
    if (v.locale !== undefined && v.locale !== getLocale()) return { state: "idle" };
    if (parsed.success && (v.reason === "tank_change" || v.reason === "water_test")) {
      return {
        state: "ready",
        reason: v.reason,
        since: String(v.since ?? ""),
        summary: parsed.data.summary,
        prompts: parsed.data.prompts,
        locale: typeof v.locale === "string" ? v.locale : undefined,
      };
    }
  }
  return { state: "idle" };
}

function writeState(state: PlanReviewState): void {
  db.insert(appSettings)
    .values({ key: PLAN_REVIEW_KEY, value: state as never })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: state as never } })
    .run();
}

/** Mark a review as needed (idempotent; never interrupts a running review). */
export function requestPlanReview(reason: PlanReviewReason): void {
  const cur = getPlanReviewState();
  if (cur.state === "thinking") return; // running review will pick up current data anyway
  writeState({ state: "pending", reason, since: new Date().toISOString() });
}

/** User saw/used/dismissed the recommendations → back to idle. */
export function markPlanReviewed(): void {
  writeState({ state: "idle" });
}

/**
 * Run the review: pending → thinking → (ready|idle). Returns the final state.
 * Kept synchronous-ish for the route: the route sets thinking first, then
 * awaits this; a slow provider keeps the badge pulsing via polling.
 */
export async function runPlanReview(): Promise<PlanReviewState> {
  const cur = getPlanReviewState();
  if (cur.state !== "pending") return cur;
  const reason = cur.reason;
  writeState({ state: "thinking", reason, since: new Date().toISOString() });

  try {
    const { executePlanReview } = await import("./plan-review-runner");
    const result = await executePlanReview(reason);
    if (result === null || !result.shouldChange || result.prompts.length === 0) {
      writeState({ state: "idle" }); // coach says: plan is fine
      return { state: "idle" };
    }
    const ready: PlanReviewState = {
      state: "ready",
      reason,
      since: new Date().toISOString(),
      summary: result.summary,
      prompts: result.prompts,
      locale: getLocale(),
    };
    writeState(ready);
    return ready;
  } catch (err) {
    console.error("[plan-review] failed, resetting to idle", err);
    writeState({ state: "idle" });
    return { state: "idle" };
  }
}
