/**
 * Scheduler core — THE most critical pure logic in Aquaman (TechDesign v1.2 §4.2).
 *
 * Semantics (fixed by plan review, do not deviate):
 * - originalDueAt: created ONCE via nextPreferredDay(base + interval), never moves
 *   → honest backlog, catch-up priority, AI context
 * - plannedFor: projection = max(originalDue, snoozedUntil); if overdue and
 *   autoReschedule → nextPreferredDay(today). READ-ONLY — never persisted.
 * - missedSlots(schedule, today): count of preferred weekdays in (originalDue, today]
 *   → "interval too tight?" hint (≥3), success metric 1b, ICS SEQUENCE
 * - occurrencesInRange: 90-day horizon; ONLY the current occurrence is projected,
 *   future ones sit on the fixed grid from originalDueAt (variant B)
 * - nextPreferredDay is INCLUSIVE (a due date that already matches → itself)
 * - weekday mask 0 = invalid (zod) + defensive fallback "every day" to avoid
 *   infinite search loops
 */

import { addDays, dayMatchesMask, today as todayStr } from "./dates";

export const ALL_DAYS_MASK = 0b1111111; // 127
export const MISSED_SLOTS_HINT = 3;

/**
 * Tight-gap policy (issue #1): what to do when the first fixed-grid point
 * after the projected current occurrence lands closer than
 * tightGapThreshold% of intervalDays — possible after a catch-up.
 *  - "fixed"    (Option A): keep the grid untouched (occasional "so soon?")
 *  - "suppress" (Option C): skip that first grid point, next one follows
 *              (calm after a stress period — PRD "friendly, not nagging")
 */
export type TightGapPolicy = "fixed" | "suppress";
export const DEFAULT_TIGHT_GAP_POLICY: TightGapPolicy = "suppress";
export const DEFAULT_TIGHT_GAP_THRESHOLD_PCT = 50; // % of intervalDays

export type ScheduleLike = {
  intervalDays: number;
  preferredDays: number; // 7-bit mask, bit 0 = Mon … bit 6 = Sun
  autoReschedule: boolean;
  lastDoneAt: string | null; // ISO UTC
  snoozedUntil: string | null; // ISO UTC
  createdAt: string; // ISO UTC
  /** per-schedule tight-gap behavior; default: suppress @ 50% */
  tightGapPolicy?: TightGapPolicy | null;
  /** threshold as % of intervalDays (1–99); default: 50 */
  tightGapThresholdPct?: number | null;
};

function isoToDateStr(iso: string): string {
  return iso.slice(0, 10);
}

/** Defensive mask normalization: 0 or invalid → every day (guards infinite loops). */
function maskOr(mask: number): number {
  return Number.isInteger(mask) && mask > 0 && mask <= ALL_DAYS_MASK ? mask : ALL_DAYS_MASK;
}

/**
 * Next date (>= fromStr, INCLUSIVE) whose weekday is set in the mask.
 * Pure string/day arithmetic — no timezone drift.
 */
export function nextPreferredDay(fromStr: string, mask: number): string {
  const m = maskOr(mask);
  let d = fromStr;
  for (let i = 0; i < 7; i++) {
    if (dayMatchesMask(d, m)) return d;
    d = addDays(d, 1);
  }
  return d; // unreachable with valid mask, but defensive
}

/**
 * The original due date for the CURRENT occurrence.
 * = nextPreferredDay((lastDoneAt ?? createdAt) + intervalDays)
 * Weekday-gridded ONCE at creation of the occurrence (review N.3) — otherwise
 * interval 10 on a weekend-only schedule targets a Tuesday and the user is
 * behind by construction.
 *
 * NOTE: For a given schedule this recomputes from lastDoneAt — i.e. it is the
 * ORIGINAL due of the not-yet-done occurrence. Persisting is optional; the
 * ICS UID must be derived from this value (stable while the occurrence is open).
 */
export function originalDueAt(schedule: ScheduleLike): string {
  const baseStr = isoToDateStr(schedule.lastDoneAt ?? schedule.createdAt);
  const raw = addDays(baseStr, schedule.intervalDays);
  return nextPreferredDay(raw, schedule.preferredDays);
}

/**
 * Full occurrence projection for the CURRENT (open) slot.
 * Pure function — no DB writes. Returns both dates so callers can show honest
 * backlog (originalDueAt) AND clean plan (plannedFor).
 */
export function nextDue(
  schedule: ScheduleLike,
  now: Date = new Date(),
  tz?: string,
): { originalDueAt: string; plannedFor: string; overdueDays: number } {
  const original = originalDueAt(schedule);
  const today = todayStr(tz, now);

  let planned = original;

  // 1) snooze wins over everything for this occurrence
  if (schedule.snoozedUntil) {
    const snoozeStr = isoToDateStr(schedule.snoozedUntil);
    if (snoozeStr > planned) planned = snoozeStr;
  }

  // 2) auto-reschedule projection: overdue → next preferred day from today
  //    (only if we're PAST the planned date)
  if (schedule.autoReschedule && planned < today) {
    planned = nextPreferredDay(today, schedule.preferredDays);
  }

  const overdueDays = original < today ? dayCount(original, today) : 0;

  return { originalDueAt: original, plannedFor: planned, overdueDays };
}

/** Whole days between two YYYY-MM-DD strings (b - a). */
export function dayCount(a: string, b: string): number {
  const [y1, m1, d1] = a.split("-").map(Number);
  const [y2, m2, d2] = b.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

/**
 * Missed preferred slots in (originalDue, today] — the honest "how far behind"
 * counter. Pure formula (review N.2): counts preferred weekdays the task was
 * plausibly expected on but wasn't done. Feeds the "interval too tight?" hint,
 * success metric 1b and the ICS SEQUENCE.
 */
export function missedSlots(schedule: ScheduleLike, now: Date = new Date(), tz?: string): number {
  const original = originalDueAt(schedule);
  const t = todayStr(tz, now);
  if (t <= original) return 0;
  const m = maskOr(schedule.preferredDays);
  let count = 0;
  let d = addDays(original, 1);
  while (d <= t) {
    if (dayMatchesMask(d, m)) count++;
    d = addDays(d, 1);
  }
  return count;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** First fixed-grid point strictly after `afterStr` (chain from `original`). */
function firstGridPointAfter(original: string, afterStr: string, schedule: ScheduleLike): string | null {
  let cur = original;
  let guard = 0;
  while (guard++ < 1000) {
    cur = nextPreferredDay(addDays(cur, schedule.intervalDays), schedule.preferredDays);
    if (cur > afterStr) return cur;
  }
  return null;
}

/**
 * All occurrences (YYYY-MM-DD) in [fromStr, toStr] — 90-day ICS horizon.
 * Variant B (review N.1.6): future occurrences sit on the FIXED grid starting
 * at originalDueAt (originalDue, then +interval chained, each weekday-gridded
 * in turn), because chaining from plannedFor would drag the whole calendar
 * along on every day of backlog. ONLY the current occurrence gets the
 * reschedule projection.
 *
 * ONE algorithm regardless of whether `original` is in the past or future
 * relative to `now` (code review finding "Hoch 1": two separate formulas here
 * used to produce different future grids for the same schedule depending on
 * which day you asked from — the k*interval-from-original arithmetic branch
 * and the cur+interval chain branch drift apart whenever intervalDays isn't a
 * multiple of 7). The chain below is single-sourced and dedupes anything at
 * or before the projected current occurrence, so it no longer matters which
 * day the caller views it from.
 */
export function occurrencesInRange(
  schedule: ScheduleLike,
  fromStr: string,
  toStr: string,
  now: Date = new Date(),
  tz?: string,
): string[] {
  const original = originalDueAt(schedule);
  const projection = nextDue(schedule, now, tz);

  const out: string[] = [];
  const seen = new Set<string>();
  const add = (d: string) => {
    if (d >= fromStr && d <= toStr && !seen.has(d)) {
      out.push(d);
      seen.add(d);
    }
  };

  // current (open) occurrence → the projection (covers snooze + auto-reschedule)
  add(projection.plannedFor);

  // Tight-gap suppression (issue #1, Option C): if the FIRST grid point after
  // the projection is closer than threshold% of intervalDays, skip it. Only
  // ever affects one grid point (grid spacing == intervalDays). "fixed"
  // (Option A) keeps every grid point — the user chooses per schedule.
  const policy: TightGapPolicy = schedule.tightGapPolicy ?? DEFAULT_TIGHT_GAP_POLICY;
  const thresholdPct = clamp(
    schedule.tightGapThresholdPct ?? DEFAULT_TIGHT_GAP_THRESHOLD_PCT,
    1,
    99,
  );
  let suppressNext = false;
  if (policy === "suppress") {
    const firstAfter = firstGridPointAfter(original, projection.plannedFor, schedule);
    if (firstAfter !== null) {
      const gap = dayCount(projection.plannedFor, firstAfter);
      if (gap * 100 <= thresholdPct * schedule.intervalDays) suppressNext = true;
    }
  }

  // fixed grid, chained from originalDueAt — always the same sequence of
  // dates regardless of `now`. Grid points at or before the projected current
  // occurrence ARE that occurrence (already emitted above) and are skipped.
  let cur = original;
  let guard = 0;
  while (cur <= toStr && guard++ < 1000) {
    if (cur > projection.plannedFor) {
      if (suppressNext) {
        suppressNext = false; // skip exactly one grid point
      } else {
        add(cur);
      }
    }
    cur = nextPreferredDay(addDays(cur, schedule.intervalDays), schedule.preferredDays);
  }

  return out.sort();
}

/**
 * Catch-up priority weight (PRD 5.3): water_change > fertilize > filter > rest;
 * older backlog weighs more.
 */
export function catchUpWeight(actionType: string, overdueDays: number): number {
  const base: Record<string, number> = {
    water_change: 100,
    fertilize: 60,
    filter_change: 40,
    filter_clean: 40,
  };
  return (base[actionType] ?? 20) + overdueDays * 10;
}
