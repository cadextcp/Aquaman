/**
 * Statistics tests (Phase 5): monthly activity, median care delay
 * (metric 1a), chronic overload (1b), AI cost retrospective.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

const TMP = path.join(tmpdir(), `aquaman-stats-${Date.now()}`);
process.env.AQUAMAN_DATA_DIR = TMP;

beforeAll(async () => {
  mkdirSync(TMP, { recursive: true });
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const { db } = await import("../src/lib/db");
  migrate(db, { migrationsFolder: "./drizzle" });

  const { tanks, schedules, maintenanceLogs, waterTests, feedLogs, aiCalls } = await import("../src/lib/db/schema");

  const tank = db
    .insert(tanks)
    .values({ name: "Stats Tank", volumeL: 120, waterType: "fresh", tankState: "established" })
    .returning()
    .get();

  // water_change every 7 days, all days; created 2026-07-01
  // completions: 07-08 (on time), 07-18 (3 days late), 07-29 (4 days late)
  db.insert(schedules).values({
    tankId: tank.id, actionType: "water_change", intervalDays: 7, preferredDays: 127,
    createdAt: "2026-07-01T00:00:00.000Z",
  }).run();
  const logs: (typeof maintenanceLogs.$inferInsert)[] = [
    { tankId: tank.id, actionType: "water_change", doneAt: "2026-07-08T10:00:00.000Z", source: "user" },
    { tankId: tank.id, actionType: "water_change", doneAt: "2026-07-18T10:00:00.000Z", source: "user" },
    { tankId: tank.id, actionType: "water_change", doneAt: "2026-07-29T10:00:00.000Z", source: "user" },
    // fertilize logs belong to a fertilize schedule that does NOT exist → ignored
    { tankId: tank.id, actionType: "fertilize", doneAt: "2026-07-10T10:00:00.000Z", source: "user" },
  ];
  for (const l of logs) db.insert(maintenanceLogs).values(l).run();

  db.insert(waterTests).values({
    tankId: tank.id, measuredAt: "2026-07-15T08:00:00.000Z", values: { no3: 15 },
  }).run();

  db.insert(feedLogs).values({ tankId: tank.id, day: "2026-07-15", fedAt: "2026-07-15T07:00:00.000Z", timesFed: 2 }).run();
  db.insert(feedLogs).values({ tankId: tank.id, day: "2026-07-16", fedAt: "2026-07-16T07:00:00.000Z", timesFed: 1 }).run();

  db.insert(aiCalls).values([
    { day: "2026-07-20", provider: "zai", model: "glm-4.6", promptTokens: 1000, completionTokens: 200, costEstimateMicros: 1044, purpose: "coach" },
    { day: "2026-07-20", provider: "zai", model: "glm-4.6", promptTokens: 500, completionTokens: 100, costEstimateMicros: 500, purpose: "coach" },
    { day: "2026-07-22", provider: "anthropic", model: "claude-sonnet-4-5", promptTokens: 2000, completionTokens: 400, costEstimateMicros: 12000, purpose: "coach" },
  ]).run();
});

afterAll(async () => {
  const { closeDb } = await import("./helpers");
  closeDb();
  rmSync(TMP, { recursive: true, force: true });
});

describe("monthlyStats", () => {
  it("counts water changes, feedings, tests, other care for the month", async () => {
    const { monthlyStats } = await import("../src/lib/stats");
    const s = monthlyStats("2026-07");
    expect(s.waterChanges).toBe(3);
    expect(s.feedings).toBe(3); // 2 + 1
    expect(s.waterTests).toBe(1);
    expect(s.otherMaintenance).toBe(1); // the fertilize log (no schedule matched... but it IS a log)
  });

  it("a month with no activity is all zeros", async () => {
    const { monthlyStats } = await import("../src/lib/stats");
    const s = monthlyStats("2026-01");
    expect(s.waterChanges).toBe(0);
    expect(s.feedings).toBe(0);
    expect(s.waterTests).toBe(0);
    expect(s.otherMaintenance).toBe(0);
  });
});

describe("careReliabilityStats (metric 1a: median delay)", () => {
  it("computes per-action median from consecutive completions", async () => {
    const { careReliabilityStats } = await import("../src/lib/stats");
    const stats = careReliabilityStats();
    const wc = stats.find((s) => s.actionType === "water_change");
    expect(wc).toBeDefined();
    // occurrences: due 07-08 done 07-08 (0 d), due 07-15 done 07-18 (3 d), due 07-22 done 07-29 (7 d)
    // delays [0, 3, 7] → median 3
    expect(wc!.count).toBe(3);
    expect(wc!.medianDelayDays).toBe(3);
  });

  it("logs without a matching schedule are not counted", async () => {
    const { careReliabilityStats } = await import("../src/lib/stats");
    const stats = careReliabilityStats();
    expect(stats.find((s) => s.actionType === "fertilize")).toBeUndefined();
  });
});

describe("aiCostStats", () => {
  it("aggregates calls, tokens, cost and per-model breakdown", async () => {
    const { aiCostStats } = await import("../src/lib/stats");
    // all seeded rows are July 2026 — a 30-day window from "today" (2026-08)
    // may or may not include them depending on the real clock. Use a large
    // window to make the test deterministic.
    const s = aiCostStats(400);
    expect(s.calls).toBe(3);
    expect(s.promptTokens).toBe(3500);
    expect(s.completionTokens).toBe(700);
    expect(s.byModel.find((m) => m.model === "glm-4.6")!.calls).toBe(2);
    expect(s.byModel.find((m) => m.model === "claude-sonnet-4-5")!.calls).toBe(1);
  });
});

describe("chronicOverload (metric 1b)", () => {
  it("lists schedules with missedSlots >= 3", async () => {
    const { chronicOverload } = await import("../src/lib/stats");
    // schedule created 2026-07-01, interval 7, never done after 07-29 →
    // by "today" (real clock, 2026-08+) it is far past due → many missed slots
    const list = chronicOverload();
    expect(list.length).toBeGreaterThanOrEqual(1);
    const wc = list.find((o) => o.actionType === "water_change");
    expect(wc!.missedSlots).toBeGreaterThanOrEqual(3);
    expect(wc!.tankName).toBe("Stats Tank");
  });
});

/**
 * scheduleAdherence is pure — no DB rows needed. Fixed `now` keeps every case
 * deterministic. All doneAt instants are 10:00Z (noon Berlin, same local day)
 * unless a test deliberately probes the app-tz day boundary.
 */
describe("scheduleAdherence (30 d, reset-grid semantics)", () => {
  type AdhSchedule = Parameters<Awaited<typeof import("../src/lib/stats")>["scheduleAdherence"]>[0];
  const NOW = new Date("2026-08-28T12:00:00.000Z"); // today 2026-08-28, window from 2026-07-29
  const sched = (over: Partial<AdhSchedule> = {}): AdhSchedule => ({
    id: 1,
    intervalDays: 7,
    preferredDays: 127,
    lastDoneAt: null,
    createdAt: "2026-06-01T00:00:00.000Z",
    active: true,
    ...over,
  });
  const logs = (days: string[]) => days.map((d) => ({ actionType: "water_change", doneAt: `${d}T10:00:00.000Z` }));

  it("regression: catching up after a late completion is scored on the real grid, not 0%", async () => {
    const { scheduleAdherence } = await import("../src/lib/stats");
    // on-time weekly chain until 07-06, one 19-day-late catch-up on 08-01,
    // then perfectly on time again (08-08, 08-15, 08-22)
    const pct = scheduleAdherence(
      sched(),
      logs(["2026-06-08", "2026-06-15", "2026-06-22", "2026-06-29", "2026-07-06", "2026-08-01", "2026-08-08", "2026-08-15", "2026-08-22"]),
      30,
      NOW,
    );
    // counted: the lingering occurrence closed 08-01 (miss) + 3 on-time → 3/4
    expect(pct).toBe(75); // the old createdAt-frozen grid scored this 0%
  });

  it("closing early counts as on time", async () => {
    const { scheduleAdherence } = await import("../src/lib/stats");
    // due 07-08, done 07-06 via "done early"
    const pct = scheduleAdherence(sched({ createdAt: "2026-07-01T00:00:00.000Z" }), logs(["2026-07-06"]), 30, new Date("2026-07-12T12:00:00.000Z"));
    expect(pct).toBe(100);
  });

  it("a completion just after local midnight is the local day, not the UTC day", async () => {
    const { scheduleAdherence } = await import("../src/lib/stats");
    // due 07-08, done 2026-07-07T22:30Z = 07-08 00:30 Berlin → on time.
    // UTC slicing read 07-07 and scored a miss.
    const pct = scheduleAdherence(
      sched({ createdAt: "2026-07-01T00:00:00.000Z" }),
      [{ actionType: "water_change", doneAt: "2026-07-07T22:30:00.000Z" }],
      30,
      new Date("2026-07-12T12:00:00.000Z"),
    );
    expect(pct).toBe(100);
  });

  it("an occurrence still open today counts as a miss (honest backlog)", async () => {
    const { scheduleAdherence } = await import("../src/lib/stats");
    const pct = scheduleAdherence(sched(), [], 30, NOW);
    expect(pct).toBe(0); // due 2026-06-08, never closed — visible, not hidden as null
  });

  it("returns null when nothing was live in the window", async () => {
    const { scheduleAdherence } = await import("../src/lib/stats");
    // brand-new 30-day schedule: first due 2026-09-24, outside today
    expect(scheduleAdherence(sched({ createdAt: "2026-08-25T00:00:00.000Z", intervalDays: 30 }), [], 30, NOW)).toBeNull();
    // ended schedule fully resolved before the window
    expect(
      scheduleAdherence(
        sched({ endsOn: "2026-06-20" }),
        logs(["2026-06-08", "2026-06-15"]),
        30,
        NOW,
      ),
    ).toBeNull();
  });

  it("a weeks-late closure of an old occurrence counts in the window as a miss", async () => {
    const { scheduleAdherence } = await import("../src/lib/stats");
    const pct = scheduleAdherence(sched(), logs(["2026-08-01"]), 30, NOW);
    expect(pct).toBe(0); // single live occurrence (due 06-08, closed 08-01) → 0/1
  });

  it("same-day duplicate completions close one occurrence, not two", async () => {
    const { scheduleAdherence } = await import("../src/lib/stats");
    const pct = scheduleAdherence(
      sched({ createdAt: "2026-07-01T00:00:00.000Z" }),
      logs(["2026-07-08", "2026-07-08"]),
      30,
      new Date("2026-07-12T12:00:00.000Z"),
    );
    expect(pct).toBe(100);
  });
});

describe("injected `now` (both windowed summaries)", () => {
  // Both functions take `now` so a caller can pin one instant — they used to
  // accept it and then read the wall clock via today(), which made the whole
  // parameter a lie: seeded July logs counted or not depending on the real
  // date the suite happened to run on.
  it("crossTankStats counts the 30 days before the GIVEN instant", async () => {
    const { crossTankStats } = await import("../src/lib/stats");
    // 2026-08-01: the four July logs are inside the 30-day window
    expect(crossTankStats(new Date("2026-08-01T12:00:00.000Z")).actions).toBe(4);
    // a year later the same rows are far outside it
    expect(crossTankStats(new Date("2027-08-01T12:00:00.000Z")).actions).toBe(0);
  });

  it("weeklySummary counts the 7 days before the GIVEN instant", async () => {
    const { weeklySummary } = await import("../src/lib/stats");
    // week of 2026-07-29: only the 07-29 water change falls in it
    expect(weeklySummary(new Date("2026-07-30T12:00:00.000Z")).closed).toBe(1);
    // the window is open-ended (everything from `now` - 7d onwards), which is
    // invisible in production where `now` IS today: from 07-13 that means the
    // 07-18 AND the 07-29 row
    expect(weeklySummary(new Date("2026-07-20T12:00:00.000Z")).closed).toBe(2);
    expect(weeklySummary(new Date("2027-01-01T12:00:00.000Z")).closed).toBe(0);
  });

  it("scopes to one tank with an injected instant (dashboard tank filter)", async () => {
    const { crossTankStats } = await import("../src/lib/stats");
    const { db } = await import("../src/lib/db");
    const { tanks } = await import("../src/lib/db/schema");
    const id = db.select().from(tanks).all()[0].id;
    expect(crossTankStats(new Date("2026-08-01T12:00:00.000Z"), id).actions).toBe(4);
    expect(crossTankStats(new Date("2026-08-01T12:00:00.000Z"), id + 999).actions).toBe(0);
  });
});
