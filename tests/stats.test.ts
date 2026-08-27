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
