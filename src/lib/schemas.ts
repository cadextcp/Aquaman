import { z } from "zod";
import { FRESHWATER_RANGES, SALTWATER_RANGES, type Range } from "./domain/ranges";
import { SCHEDULABLE_ACTION_TYPES } from "./domain/action-types";

/**
 * Shared zod schemas — SAME schema validates the client form and the
 * Server Action (code_patterns.md). Domain invariants (issues #2/#3/#1):
 * intervalDays ≥ 1, preferredDays 1–127, tightGapThresholdPct 1–99.
 */

export const plantSchema = z.object({
  name: z.string().trim().min(1).max(80),
  qty: z.number().int().min(0).max(999),
});

export const fishSchema = z.object({
  species: z.string().trim().min(1).max(80),
  qty: z.number().int().min(0).max(999),
});

export const tankInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60),
  volumeL: z.number().int().min(1).max(100000),
  waterType: z.enum(["fresh", "salt"]),
  plants: z.array(plantSchema).max(50).default([]),
  fish: z.array(fishSchema).max(50).default([]),
  foods: z.array(z.object({ name: z.string().trim().min(1).max(60), amount: z.string().trim().max(30), unit: z.string().trim().max(20) })).max(20).default([]),
  hasCo2: z.boolean().default(false),
  hasHeater: z.boolean().default(false),
  hasFilter: z.boolean().default(true),
  filterType: z.string().trim().max(60).optional().nullable(),
  tankState: z.enum(["cycling", "established"]).default("established"),
});
export type TankInput = z.infer<typeof tankInputSchema>;

export const scheduleInputSchema = z.object({
  tankId: z.number().int().positive(),
  actionType: z.enum(SCHEDULABLE_ACTION_TYPES as [string, ...string[]]),
  intervalDays: z.number().int().min(1, "Interval must be ≥ 1 day").max(365),
  preferredDays: z
    .number()
    .int()
    .min(1, "Select at least one weekday")
    .max(127, "Invalid weekday mask"),
  autoReschedule: z.boolean().default(true),
  tightGapPolicy: z.enum(["fixed", "suppress"]).nullable().default(null),
  tightGapThresholdPct: z.number().int().min(1).max(99).nullable().default(null),
  // issue #30: concrete instructions, e.g. "30 L of 60 L (50 %)" / "10 ml iron fertilizer"
  details: z.string().trim().max(300).optional().nullable(),
  // issue #42: structured details (percent / nutrient doses / food amounts)
  detailData: z.record(z.string(), z.unknown()).optional().nullable(),
  // issue #31: optional end date — after it, the event vanishes from calendar/ICS
  endsOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "endsOn must be YYYY-MM-DD")
    .optional()
    .nullable()
    .refine((v) => v === null || v === undefined || v >= new Date().toISOString().slice(0, 10) || true, "invalid date"),
});
export type ScheduleInput = z.infer<typeof scheduleInputSchema>;

export const snoozeInputSchema = z.object({
  scheduleId: z.number().int().positive(),
  until: z.string().date(), // YYYY-MM-DD
});
export type SnoozeInput = z.infer<typeof snoozeInputSchema>;

export const waterTestInputSchema = z.object({
  tankId: z.number().int().positive(),
  measuredAt: z.string().datetime().optional(),
  // Issue #24: keys whitelisted per water type; values bounded for plausibility.
  // Validated in validateWaterValues() against the range catalogs (see actions).
  values: z.record(z.string(), z.number().nonnegative().nullable()),
  note: z.string().trim().max(500).optional().nullable(),
});

/** Known parameter keys per water type (derived from the range catalogs). */
export function knownWaterKeys(waterType: "fresh" | "salt"): Set<string> {
  const ranges = waterType === "salt" ? SALTWATER_RANGES : FRESHWATER_RANGES;
  return new Set(ranges.map((r: Range) => r.key));
}

/**
 * Validate a water-values map for a given water type.
 * - unknown keys → rejected (they would poison export + AI context, issue #24)
 * - values above 10× the catalog warnMax (or warnMin-based floor) → rejected
 *   as physically implausible (fat-finger guard: 250 °C instead of 25 °C)
 * Returns [clean, error]
 */
export function validateWaterValues(
  values: Record<string, number | null>,
  waterType: "fresh" | "salt",
): [Record<string, number | null> | null, string | null] {
  const ranges: Range[] = waterType === "salt" ? SALTWATER_RANGES : FRESHWATER_RANGES;
  const byKey = new Map(ranges.map((r: Range) => [r.key, r]));
  const clean: Record<string, number | null> = {};
  for (const [k, v] of Object.entries(values)) {
    const range = byKey.get(k);
    if (!range) return [null, `Unknown parameter: ${k}`];
    if (v === null) { clean[k] = null; continue; }
    // Fat-finger guard: 3× beyond the critical threshold is implausible for ANY
    // parameter (temp: 28×3=84 → 250 rejected; no3: 50×3=150; ph: 8×3=24).
    const ceiling = (range.warnMax ?? range.max) * 3;
    if (v > ceiling) return [null, `${k}: ${v} is not a plausible value (max ${ceiling})`];
    clean[k] = v;
  }
  return [clean, null];
}
export type WaterTestInput = z.infer<typeof waterTestInputSchema>;

/** Weekday mask helpers: bit 0 = Mon … bit 6 = Sun. */
export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export function maskToDays(mask: number): number[] {
  return WEEKDAY_LABELS.map((_, i) => i).filter((i) => ((mask >> i) & 1) === 1);
}

export function daysToMask(days: number[]): number {
  return days.reduce((m, d) => m | (1 << d), 0);
}

export const ALL_DAYS = 127;
export const WEEKEND = 0b1100000;
export const WEEKDAYS = 0b0011111;
