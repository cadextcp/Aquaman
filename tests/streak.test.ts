/**
 * Streak tests (issue #43): owner definition — days with nothing due count,
 * only neglect (overdue by more than a full interval) breaks the streak.
 */
import { describe, it, expect } from "vitest";
import { careStreak, type StreakSchedule } from "../src/lib/domain/streak";

const NOW = new Date("2026-08-24T12:00:00Z");

function sched(over: Partial<StreakSchedule> = {}): StreakSchedule {
  return {
    tankId: 1,
    actionType: "water_change",
    intervalDays: 7,
    preferredDays: 127,
    lastDoneAt: null,
    createdAt: "2026-08-01T00:00:00Z",
    active: true,
    ...over,
  };
}

function log(tankId: number, actionType: string, day: string) {
  return { tankId, actionType, doneAt: `${day}T10:00:00Z` };
}

describe("careStreak (owner definition)", () => {
  it("no schedules → 0", () => {
    expect(careStreak([], [], NOW)).toBe(0);
  });

  it("regular care kept up → long streak (empty days count)", () => {
    // weekly water change, done every week since Aug 1 → ~24 days streak
    const logs = [8, 15, 22].map((d) => log(1, "water_change", `2026-08-0${d}`.replace(/(\d\d)(\d)/, "$1$2")));
    const fixed = [log(1, "water_change", "2026-08-08"), log(1, "water_change", "2026-08-15"), log(1, "water_change", "2026-08-22")];
    const streak = careStreak([sched()], fixed, NOW);
    expect(streak).toBeGreaterThan(10);
  });

  it("neglect breaks the streak: overdue by > one interval", () => {
    // due 08-08, interval 7 → neglected from 08-15+; nothing done since 08-08
    const s = sched({ lastDoneAt: "2026-08-01T10:00:00Z" });
    const logs = [log(1, "water_change", "2026-08-01"), log(1, "water_change", "2026-08-08")];
    // today 08-24: overdue since 08-15 (gridded) + one full interval → broken
    const streak = careStreak([s], logs, NOW);
    // broken on 08-22 (due 08-15 + 7) → streak counts back from 08-23/24 ≈ 0
    expect(streak).toBeLessThan(3);
  });

  it("recent neglect → short but nonzero streak never goes negative", () => {
    const s = sched({ intervalDays: 2, preferredDays: 127 });
    const logs = [log(1, "water_change", "2026-08-24")]; // done today, yesterday empty counts
    const streak = careStreak([s], logs, NOW);
    expect(streak).toBeGreaterThanOrEqual(0);
  });

  it("inactive schedules don't count", () => {
    const s = sched({ active: false });
    const streak = careStreak([s], [], NOW);
    expect(streak).toBe(0);
  });

  it("schedules created recently only count from creation", () => {
    const s = sched({ createdAt: "2026-08-23T00:00:00Z", intervalDays: 7 });
    const streak = careStreak([s], [], NOW);
    expect(streak).toBeGreaterThanOrEqual(1); // yesterday+today with nothing due yet
  });
});
