/**
 * Usage statistics (Phase 5 — PRD §5.10): activity this month, care
 * reliability (success metric 1a: median delay originalDueAt → doneAt),
 * chronic-overload indicator (1b: missedSlots ≥ 3) and an AI cost
 * retrospective over the last 30 days.
 *
 * Pure reads via db — no projections written anywhere (auto-reschedule
 * stays a read-only projection; stats never mutate anything).
 */

import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { maintenanceLogs, waterTests, feedLogs, schedules, aiCalls } from "@/lib/db/schema";
import { listTanks, listSchedules } from "@/lib/repo";
import { missedSlots, nextPreferredDay } from "@/lib/domain/scheduler";
import { addDays, today } from "@/lib/domain/dates";

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
      const baseStr = (prevDone ?? schedule.createdAt).slice(0, 10);
      const raw = addDays(baseStr, schedule.intervalDays);
      const originalDue = nextPreferredDay(raw, schedule.preferredDays);
      const doneDay = doneAt.slice(0, 10);
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
