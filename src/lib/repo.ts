import { db } from "@/lib/db";
import { tanks, schedules, maintenanceLogs, waterTests, feedLogs } from "@/lib/db/schema";
import { and, desc, eq, isNull, gte } from "drizzle-orm";
import type { Tank, Schedule, MaintenanceLog, WaterTest, FeedLog } from "@/lib/db/schema";

// ==================== Tanks ====================

export function listTanks(): Tank[] {
  return db.select().from(tanks).where(isNull(tanks.deletedAt)).all();
}

export function getTank(id: number): Tank | undefined {
  return db.select().from(tanks).where(and(eq(tanks.id, id), isNull(tanks.deletedAt))).get();
}

// ==================== Schedules ====================

export function listSchedules(tankId?: number): (Schedule & { tankName: string })[] {
  const rows = db
    .select({ s: schedules, tankName: tanks.name })
    .from(schedules)
    .innerJoin(tanks, eq(schedules.tankId, tanks.id))
    .where(and(eq(schedules.active, true), isNull(tanks.deletedAt)))
    .all();
  const filtered = tankId ? rows.filter((r) => r.s.tankId === tankId) : rows;
  return filtered.map((r) => ({ ...r.s, tankName: r.tankName }));
}

// ==================== Maintenance logs ====================

export function addMaintenanceLog(entry: {
  tankId: number;
  actionType: string;
  doneAt?: string;
  note?: string;
  source?: "user" | "ai_proposed";
}): MaintenanceLog {
  return db
    .insert(maintenanceLogs)
    .values({
      tankId: entry.tankId,
      actionType: entry.actionType,
      doneAt: entry.doneAt ?? new Date().toISOString(),
      note: entry.note,
      source: entry.source ?? "user",
    })
    .returning()
    .get();
}

export function recentLogs(tankId: number, limit = 20): MaintenanceLog[] {
  return db
    .select()
    .from(maintenanceLogs)
    .where(eq(maintenanceLogs.tankId, tankId))
    .orderBy(desc(maintenanceLogs.doneAt))
    .limit(limit)
    .all();
}

// ==================== Water tests ====================

export function addWaterTest(entry: {
  tankId: number;
  measuredAt?: string;
  values: Record<string, number | null>;
  note?: string;
}): WaterTest {
  return db
    .insert(waterTests)
    .values({
      tankId: entry.tankId,
      measuredAt: entry.measuredAt ?? new Date().toISOString(),
      values: entry.values,
      note: entry.note,
    })
    .returning()
    .get();
}

export function waterTestsForTank(tankId: number, days = 365): WaterTest[] {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  return db
    .select()
    .from(waterTests)
    .where(and(eq(waterTests.tankId, tankId), gte(waterTests.measuredAt, since)))
    .orderBy(desc(waterTests.measuredAt))
    .all();
}

// ==================== Feed (daily habit) ====================

export function todayFeed(tankId: number, localDay: string): FeedLog | undefined {
  return db
    .select()
    .from(feedLogs)
    .where(and(eq(feedLogs.tankId, tankId), eq(feedLogs.day, localDay)))
    .get();
}

export function feedAllToday(localDay: string): FeedLog[] {
  return db.select().from(feedLogs).where(eq(feedLogs.day, localDay)).all();
}

/** Toggle: first tap = fed, second tap = +1, never deletes history for the day. */
export function markFed(tankId: number, localDay: string): FeedLog {
  const existing = todayFeed(tankId, localDay);
  if (existing) {
    return db
      .update(feedLogs)
      .set({ timesFed: existing.timesFed + 1, fedAt: new Date().toISOString() })
      .where(eq(feedLogs.id, existing.id))
      .returning()
      .get();
  }
  return db
    .insert(feedLogs)
    .values({ tankId, day: localDay, fedAt: new Date().toISOString(), timesFed: 1 })
    .returning()
    .get();
}
