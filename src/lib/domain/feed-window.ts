/**
 * Feeding backfill window (owner request: "edit past days if I forget to add
 * feeding"). ONE definition of "which day may the feeding stepper edit?",
 * shared by the dashboard's day navigation and the `adjustFeedOn` action —
 * a page that renders arrows for a day the action would reject is a stepper
 * that silently does nothing.
 */
import { z } from "zod";
import { today as todayStr, addDays } from "@/lib/domain/dates";
import type { ErrorCode } from "@/lib/domain/errors";

/** Feeding can be edited for this many past days (typo guard). */
export const FEED_BACKFILL_DAYS = 30;

/** Real calendar-date validation (2026-08-00 is shape-valid but not a date). */
const feedDaySchema = z.string().date();

/** Oldest day the feeding stepper may edit (inclusive). */
export function feedMinDay(t: string = todayStr()): string {
  return addDays(t, -FEED_BACKFILL_DAYS);
}

/**
 * Validate a feed day: a real YYYY-MM-DD calendar date, today or earlier, at
 * most FEED_BACKFILL_DAYS back. Returns the English message plus its code
 * (see domain/errors.ts), or null when the day is editable.
 */
export function feedDayError(
  day: string,
  t: string = todayStr(),
): { code: ErrorCode; error: string } | null {
  if (!feedDaySchema.safeParse(day).success) return { code: "feed.invalidDate", error: "Invalid date" };
  if (day > t) return { code: "feed.futureDate", error: "Cannot log feeding for a future date" };
  if (day < feedMinDay(t))
    return { code: "feed.backfillLimit", error: `Feeding can only be backfilled ${FEED_BACKFILL_DAYS} days back` };
  return null;
}

/** Clamp a `?day=` param to an editable day — anything invalid falls back to today. */
export function resolveFeedDay(dayParam: string | undefined, t: string = todayStr()): string {
  return typeof dayParam === "string" && feedDayError(dayParam, t) === null ? dayParam : t;
}
