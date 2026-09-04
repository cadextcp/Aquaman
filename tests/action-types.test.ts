/**
 * Standard-events catalog (action-types.ts) — the single source of truth for
 * action_type, consumed by schemas.ts, repo.ts, plan-structure.ts,
 * scheduler.ts, ranges.ts, ics.ts, and the AI proposal/context prompts.
 * These tests pin down: the catalog is internally consistent, and the
 * derived exports (STANDARD_PLAN_TYPES, catchUpWeight, formatDetailData)
 * keep their pre-catalog values for the pre-existing types.
 */
import { describe, it, expect } from "vitest";
import { ACTION_TYPES, ACTION_TYPE_KEYS, SCHEDULABLE_ACTION_TYPES, LOGGABLE_ACTION_TYPES, isActionType, actionTypeDef, actionLabel } from "../src/lib/domain/action-types";

describe("ACTION_TYPES catalog", () => {
  it("has 10 entries with unique keys", () => {
    expect(ACTION_TYPES).toHaveLength(10);
    expect(new Set(ACTION_TYPE_KEYS).size).toBe(10);
  });

  // Feeding is a daily habit (feed_logs), so it is the one type that is neither
  // loggable nor schedulable: a feed PLAN can never be ticked off, because
  // nothing that records a feeding writes schedules.lastDoneAt.
  it("SCHEDULABLE_ACTION_TYPES and LOGGABLE_ACTION_TYPES are all 10 but feed", () => {
    expect(SCHEDULABLE_ACTION_TYPES).toHaveLength(9);
    expect(SCHEDULABLE_ACTION_TYPES).not.toContain("feed");
    expect(LOGGABLE_ACTION_TYPES).toHaveLength(9);
    expect(LOGGABLE_ACTION_TYPES).not.toContain("feed");
  });

  it("isActionType / actionTypeDef agree on membership", () => {
    expect(isActionType("water_change")).toBe(true);
    expect(isActionType("kaffee_kochen")).toBe(false);
    expect(actionTypeDef("water_change")?.icon).toBe("drop-half");
    expect(actionTypeDef("kaffee_kochen")).toBeUndefined();
  });

  it("actionLabel: catalog label for known types, snake_case→Titlecase fallback otherwise", () => {
    expect(actionLabel("water_change")).toBe("Water change");
    expect(actionLabel("filter_change")).toBe("Filter change");
    expect(actionLabel("some_custom_thing")).toBe("Some custom thing");
  });

  it("every entry with a detailKind has a distinct, sensible weight ordering matching the pre-catalog priorities", async () => {
    const { catchUpWeight } = await import("../src/lib/domain/scheduler");
    // pre-existing relative order (PRD 5.3): water_change > fertilize > filter > rest
    expect(catchUpWeight("water_change", 0)).toBeGreaterThan(catchUpWeight("fertilize", 0));
    expect(catchUpWeight("fertilize", 0)).toBeGreaterThan(catchUpWeight("filter_change", 0));
    expect(catchUpWeight("filter_change", 0)).toBe(catchUpWeight("filter_clean", 0));
    expect(catchUpWeight("glass_clean", 0)).toBe(20 + 0); // unknown-to-old-map fallback value preserved
  });

  it("STANDARD_PLAN_TYPES (duplicate-guard types) is the pre-catalog five minus feed", async () => {
    const { STANDARD_PLAN_TYPES, isStandardPlanType } = await import("../src/lib/domain/plan-structure");
    // feed dropped out: it is no longer a plan at all, so there is no plan to
    // recommend on the tank page and nothing for the duplicate guard to guard.
    expect(new Set(STANDARD_PLAN_TYPES)).toEqual(new Set(["water_change", "fertilize", "filter_change", "water_test"]));
    expect(isStandardPlanType("substrate_vacuum")).toBe(false);
    expect(isStandardPlanType("water_top_up")).toBe(false);
  });
});
