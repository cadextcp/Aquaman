/**
 * Test helpers: direct DB access without the "use server" wrapper, so the
 * integration tests can arrange state without RPC ceremony.
 */
import { db } from "../src/lib/db";
import { tanks, schedules } from "../src/lib/db/schema";
import { eq } from "drizzle-orm";
import type { Tank, Schedule } from "../src/lib/db/schema";

export async function createTankDirect(name: string): Promise<number> {
  const row = db
    .insert(tanks)
    .values({
      name, volumeL: 60, waterType: "fresh",
      plants: [], fish: [], hasCo2: false, hasHeater: false, hasFilter: true,
      filterType: null, tankState: "established",
    })
    .returning()
    .get();
  return row.id;
}

export async function createScheduleDirect(
  tankId: number,
  opts: { actionType: string; intervalDays: number; preferredDays: number },
): Promise<Schedule> {
  return db
    .insert(schedules)
    .values({
      tankId, actionType: opts.actionType,
      intervalDays: opts.intervalDays, preferredDays: opts.preferredDays,
    })
    .returning()
    .get();
}

export function getScheduleDirect(id: number): Schedule | undefined {
  return db.select().from(schedules).where(eq(schedules.id, id)).get();
}

// re-exports from repo for convenience in tests
export { listTanks, listSchedules, recentLogs, markFed, todayFeed } from "../src/lib/repo";
export { today as todayStrLocal } from "../src/lib/domain/dates";

export type { Tank };
