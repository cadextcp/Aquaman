/**
 * Care streak (issue #43, owner definition):
 * "Days in a row without NEGLECTED care — days with nothing due count too."
 *
 * Concretely: walking back from today, a day counts when every task whose
 * ORIGINAL due date fell on or before that day was completed on/before the
 * NEXT due occurrence — i.e. nothing was ever left behind by more than one
 * full interval. Feeding (daily habit) does NOT break the streak; schedules
 * only. Overdue-but-auto-rescheduled tasks don't break it either — the
 * honest-but-forgiving core insight of this app.
 *
 * Pure function over maintenance logs + schedule rows.
 */

import { addDays, dayMatchesMask, today as todayStr } from "./dates";

export type StreakSchedule = {
  tankId: number;
  actionType: string;
  intervalDays: number;
  preferredDays: number;
  lastDoneAt: string | null;
  createdAt: string;
  active: boolean;
  /** schedule existed at all on a given day (createdAt <= day) */
};

/**
 * Consecutive days (ending today or yesterday) without neglected care.
 * Today only counts once everything DUE TODAY is done — otherwise the
 * streak shows the value as of yesterday (design: honest, no pressure).
 */
export function careStreak(
  schedules: StreakSchedule[],
  logs: { tankId: number; actionType: string; doneAt: string }[],
  now: Date = new Date(),
  tz?: string,
): number {
  if (!schedules.some((s) => s.active)) return 0; // nothing active → no streak
  const today = todayStr(tz, now);
  const logDays = new Map<string, Set<string>>(); // "tankId:action" → sorted day list
  for (const l of logs) {
    const key = `${l.tankId}:${l.actionType}`;
    const arr = logDays.get(key) ?? new Set<string>();
    arr.add(l.doneAt.slice(0, 10));
    logDays.set(key, arr);
  }

  const dayCounts = (day: string): { ok: boolean } => {
    // check every schedule that already existed on `day`
    for (const s of schedules) {
      if (!s.active) continue;
      if (s.createdAt.slice(0, 10) > day) continue; // didn't exist yet

      // last completion on/before `day`
      const days = logDays.get(`${s.tankId}:${s.actionType}`);
      let lastDone: string | null = null;
      if (days) {
        for (const d of days) if (d <= day && (!lastDone || d > lastDone)) lastDone = d;
      }

      // when was this task due (roughly) at that point?
      const anchor = lastDone ?? s.createdAt.slice(0, 10);
      let due = addDays(anchor, s.intervalDays);
      // weekday-gridded (approximate to the scheduler's semantics)
      let guard = 0;
      while (!dayMatchesMask(due, s.preferredDays) && guard++ < 7) due = addDays(due, 1);

      // neglected = overdue by more than one full interval (forgiveness window)
      if (day > addDays(due, s.intervalDays)) return { ok: false };
    }
    return { ok: true };
  };

  let streak = 0;
  let day = today;

  // today only counts if already clean
  const todayOk = dayCounts(today).ok;
  if (todayOk) streak++;
  day = addDays(day, -1);

  // walk back until a neglected day (or a day before ANY schedule existed)
  let guard = 0;
  while (guard++ < 3650) {
    const anyExisting = schedules.some((s) => s.active && s.createdAt.slice(0, 10) <= day);
    if (!anyExisting) break;
    if (!dayCounts(day).ok) break;
    streak++;
    day = addDays(day, -1);
  }

  return streak;
}
