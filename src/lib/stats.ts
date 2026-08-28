/**
 * Usage statistics (Phase 5 — PRD §5.10): activity this month, care
 * reliability (success metric 1a: median delay originalDueAt → doneAt),
 * chronic-overload indicator (1b: missedSlots ≥ 3) and an AI cost
 * retrospective over the last 30 days.
 *
 * Pure reads via db — no projections written anywhere (auto-reschedule
 * stays a read-only projection; stats never mutate anything).
 */

import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { maintenanceLogs, waterTests, feedLogs, schedules, aiCalls } from "@/lib/db/schema";
import { listTanks, listSchedules } from "@/lib/repo";
import { missedSlots, nextPreferredDay } from "@/lib/domain/scheduler";
import { addDays, today, dayMatchesMask, isoToLocalDate } from "@/lib/domain/dates";

export type MonthlyStats = {
  month: string; // YYYY-MM
  waterChanges: number;
  feedings: number;
  waterTests: number;
  otherMaintenance: number;
};

export type DelayStat = {
  actionType: string;
  medianDelayDays: number | null; // null when no completed occurrences
  count: number;
};

export type AiCostStat = {
  days: number;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  costMicros: number; // ≈ µUSD/µEUR-scale estimate — comparative, not billing
  byModel: { model: string; calls: number; tokens: number }[];
};

/** Actions per local calendar month (YYYY-MM in AQUAMAN_TIMEZONE). */
export function monthlyStats(monthStr: string): MonthlyStats {
  const from = `${monthStr}-01`;
  const lastDay = new Date(Date.UTC(Number(monthStr.slice(0, 4)), Number(monthStr.slice(5, 7)), 0))
    .toISOString()
    .slice(0, 10);
  const fromIso = `${from}T00:00:00.000Z`;
  const toIso = `${addDays(lastDay, 1)}T00:00:00.000Z`;

  const logs = db
    .select({ actionType: maintenanceLogs.actionType, doneAt: maintenanceLogs.doneAt })
    .from(maintenanceLogs)
    .where(and(gte(maintenanceLogs.doneAt, fromIso), sql`${maintenanceLogs.doneAt} < ${toIso}`))
    .all();

  const tests = db
    .select({ id: waterTests.id })
    .from(waterTests)
    .where(and(gte(waterTests.measuredAt, fromIso), sql`${waterTests.measuredAt} < ${toIso}`))
    .all()
    .length;

  const feeds = db
    .select({ timesFed: feedLogs.timesFed })
    .from(feedLogs)
    .where(and(gte(feedLogs.day, from), sql`${feedLogs.day} <= ${lastDay}`))
    .all();

  return {
    month: monthStr,
    waterChanges: logs.filter((l) => l.actionType === "water_change").length,
    feedings: feeds.reduce((acc, f) => acc + f.timesFed, 0),
    waterTests: tests,
    otherMaintenance: logs.filter((l) => !["water_change", "feed"].includes(l.actionType)).length,
  };
}

/**
 * Success metric 1a: median delay between the weekday-gridded originalDueAt
 * and the actual doneAt, per action type. Computed from maintenance logs
 * paired with the schedule state BEFORE each completion — approximated by
 * walking each schedule's completion history: for every log entry, the
 * occurrence it closed had originalDue = nextPreferredDay(lastDone + interval)
 * with lastDone being the PREVIOUS completion (or createdAt when none).
 * Delay is clamped at ≥ 0 (early completion counts as 0, not negative).
 */
export function careReliabilityStats(): DelayStat[] {
  const rows = db
    .select({ s: schedules, doneAt: maintenanceLogs.doneAt })
    .from(maintenanceLogs)
    .innerJoin(schedules, eq(maintenanceLogs.tankId, schedules.tankId))
    .where(eq(maintenanceLogs.actionType, schedules.actionType))
    .orderBy(schedules.id, maintenanceLogs.doneAt)
    .all();

  // group per schedule, then pair consecutive completions
  const bySchedule = new Map<number, { schedule: typeof schedules.$inferSelect; doneAts: string[] }>();
  for (const r of rows) {
    const entry = bySchedule.get(r.s.id) ?? { schedule: r.s, doneAts: [] };
    entry.doneAts.push(r.doneAt);
    bySchedule.set(r.s.id, entry);
  }

  const delaysByAction = new Map<string, number[]>();
  for (const { schedule, doneAts } of bySchedule.values()) {
    let prevDone: string | null = null;
    for (const doneAt of doneAts) {
      // original due of the occurrence this completion closed
      const baseStr = prevDone ? isoToLocalDate(prevDone) : isoToLocalDate(schedule.createdAt);
      const raw = addDays(baseStr, schedule.intervalDays);
      const originalDue = nextPreferredDay(raw, schedule.preferredDays);
      const doneDay = isoToLocalDate(doneAt);
      const delay = doneDay < originalDue ? 0 : dayDiff(originalDue, doneDay);
      const list = delaysByAction.get(schedule.actionType) ?? [];
      list.push(delay);
      delaysByAction.set(schedule.actionType, list);
      prevDone = doneAt;
    }
  }

  return [...delaysByAction.entries()]
    .map(([actionType, delays]) => ({
      actionType,
      count: delays.length,
      medianDelayDays: delays.length === 0 ? null : median(delays),
    }))
    .sort((a, b) => a.actionType.localeCompare(b.actionType));
}

/** Success metric 1b: active schedules currently at missedSlots ≥ 3. */
export function chronicOverload(): { scheduleId: number; tankName: string; actionType: string; missedSlots: number }[] {
  const now = new Date();
  return listSchedules()
    .map((s) => ({ s, missed: missedSlots(s, now) }))
    .filter((x) => x.missed >= 3)
    .map((x) => ({ scheduleId: x.s.id, tankName: x.s.tankName, actionType: x.s.actionType, missedSlots: x.missed }))
    .sort((a, b) => b.missedSlots - a.missedSlots);
}

/** AI usage/cost over the last N days (default 30). */
export function aiCostStats(days = 30): AiCostStat {
  const since = addDays(today(), -days);
  const rows = db.select().from(aiCalls).where(gte(aiCalls.day, since)).all();
  const byModel = new Map<string, { calls: number; tokens: number }>();
  let promptTokens = 0;
  let completionTokens = 0;
  let costMicros = 0;
  for (const r of rows) {
    promptTokens += r.promptTokens;
    completionTokens += r.completionTokens;
    costMicros += r.costEstimateMicros;
    const m = byModel.get(r.model) ?? { calls: 0, tokens: 0 };
    m.calls += 1;
    m.tokens += r.promptTokens + r.completionTokens;
    byModel.set(r.model, m);
  }
  return {
    days,
    calls: rows.length,
    promptTokens,
    completionTokens,
    costMicros,
    byModel: [...byModel.entries()].map(([model, v]) => ({ model, ...v })).sort((a, b) => b.calls - a.calls),
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function dayDiff(a: string, b: string): number {
  const [y1, m1, d1] = a.split("-").map(Number);
  const [y2, m2, d2] = b.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

// ==================== Nocturne additions (issue #43, round 2) ====================

/**
 * Adherence per schedule over the last N days (design: "94% on time"):
 * share of planned occurrences that were closed no more than 1 day after
 * their due date — closing early always counts (same clamp as the
 * median-delay metric, where early = 0 delay).
 *
 * The occurrence timeline follows the scheduler's own reset semantics
 * (originalDueAt chains from the last completion, scheduler.ts): each
 * completion closes the currently open occurrence and the next due is
 * gridded from that completion's day. An earlier version chained the grid
 * from createdAt only, so it diverged from the real schedule after the
 * first late completion and scored perfectly-caught-up users 0%.
 *
 * An occurrence is counted when it was live during the window: due date in
 * the window, closed during the window (lingering backlog), or still open
 * today (honest backlog — being behind shows, it does not hide).
 * Schedules without any live occurrence in the window return null
 * (nothing to be on time FOR — design hides the % in that case).
 */
export function scheduleAdherence(
  schedule: {
    id: number;
    intervalDays: number;
    preferredDays: number;
    lastDoneAt: string | null;
    createdAt: string;
    active: boolean;
    endsOn?: string | null;
  },
  logs: { actionType: string; doneAt: string }[],
  days = 30,
  now: Date = new Date(),
): number | null {
  const t = today(undefined, now);
  const from = addDays(t, -days);

  // completion days in app-tz, deduped, oldest first — two completions on
  // one day cannot close distinct occurrences (the base moves by day only)
  const doneDays = [...new Set(logs.map((l) => isoToLocalDate(l.doneAt)))].sort();

  let base = isoToLocalDate(schedule.createdAt);
  let ci = 0; // next completion that may close the open occurrence
  let counted = 0;
  let onTime = 0;
  // every pass consumes one completion or stops at the open occurrence,
  // so at most doneDays.length + 1 passes run — no runaway guard needed
  for (let guard = 0; guard <= doneDays.length + 1; guard++) {
    let due = addDays(base, schedule.intervalDays);
    let g2 = 0;
    while (!dayMatchesMask(due, schedule.preferredDays) && g2++ < 7) due = addDays(due, 1);
    if ((schedule.endsOn && due > schedule.endsOn) || due > t) break;

    // first completion after the base closes the open occurrence (early or late)
    while (ci < doneDays.length && doneDays[ci] <= base) ci++;
    const closedOn = ci < doneDays.length ? doneDays[ci++] : null;

    if (due >= from || closedOn === null || closedOn >= from) {
      counted++;
      if (closedOn !== null && closedOn <= addDays(due, 1)) onTime++;
    }

    if (closedOn === null) break; // occurrence stays open — no later occurrence exists
    base = closedOn;
  }

  if (counted === 0) return null;
  return Math.round((onTime / counted) * 100);
}

/** Cross-tank 30-day summary (design: "60 care actions"). */
export function crossTankStats(now: Date = new Date()) {
  const from = addDays(today(), -30);
  const fromIso = `${from}T00:00:00.000Z`;
  const logs = db.select().from(maintenanceLogs).where(gte(maintenanceLogs.doneAt, fromIso)).all();
  return { actions: logs.length };
}

/** Daily care-action counts for the last N days (design: the 30-bar activity chart). */
export function dailyActivity(days = 30): { date: string; count: number }[] {
  const t = today();
  const from = addDays(t, -(days - 1));
  const fromIso = `${from}T00:00:00.000Z`;
  const logs = db.select().from(maintenanceLogs).where(gte(maintenanceLogs.doneAt, fromIso)).all();
  const byDay = new Map<string, number>();
  for (const l of logs) {
    const d = l.doneAt.slice(0, 10);
    byDay.set(d, (byDay.get(d) ?? 0) + 1);
  }
  const out: { date: string; count: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = addDays(t, -i);
    out.push({ date: d, count: byDay.get(d) ?? 0 });
  }
  return out;
}

/** Weekly summary for the empty-queue state (design: "4 tasks closed this week, zero behind"). */
export function weeklySummary(now: Date = new Date()) {
  const t = today();
  const from = addDays(t, -7);
  const fromIso = `${from}T00:00:00.000Z`;
  const logs = db.select().from(maintenanceLogs).where(gte(maintenanceLogs.doneAt, fromIso)).all();
  return { closed: logs.length };
}

/** Cycling progress: days since creation + falling NO2 trend (design badge). */
export function cyclingInfo(tank: { tankState: string; createdAt: string; id: number }) {
  if (tank.tankState !== "cycling") return null;
  const created = new Date(tank.createdAt).getTime();
  const day = Math.max(1, Math.floor((Date.now() - created) / 86400000));
  const tests = db
    .select()
    .from(waterTests)
    .where(eq(waterTests.tankId, tank.id))
    .orderBy(desc(waterTests.measuredAt))
    .limit(3)
    .all();
  let no2trend: "falling" | "rising" | "flat" | null = null;
  const series = tests.map((x) => x.values["no2"]).filter((v): v is number => typeof v === "number");
  if (series.length >= 2) {
    no2trend = series[0] < series[series.length - 1] ? "falling" : series[0] > series[series.length - 1] ? "rising" : "flat";
  }
  return { day, no2trend };
}
