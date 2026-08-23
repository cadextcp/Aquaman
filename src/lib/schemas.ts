import { z } from "zod";

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
  hasCo2: z.boolean().default(false),
  hasHeater: z.boolean().default(false),
  hasFilter: z.boolean().default(true),
  filterType: z.string().trim().max(60).optional().nullable(),
  tankState: z.enum(["cycling", "established"]).default("established"),
});
export type TankInput = z.infer<typeof tankInputSchema>;

export const scheduleInputSchema = z.object({
  tankId: z.number().int().positive(),
  actionType: z.string().trim().min(1).max(40),
  intervalDays: z.number().int().min(1, "Interval must be ≥ 1 day").max(365),
  preferredDays: z
    .number()
    .int()
    .min(1, "Select at least one weekday")
    .max(127, "Invalid weekday mask"),
  autoReschedule: z.boolean().default(true),
  tightGapPolicy: z.enum(["fixed", "suppress"]).nullable().default(null),
  tightGapThresholdPct: z.number().int().min(1).max(99).nullable().default(null),
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
  values: z.record(z.string(), z.number().nonnegative().nullable()),
  note: z.string().trim().max(500).optional().nullable(),
});
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
