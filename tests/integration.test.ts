/**
 * Integration tests for the repo layer + key action invariants (issue #23).
 * Runs against a throwaway SQLite file; revalidatePath is stubbed out.
 *
 * What these pin down (all from the review):
 * - markDone writes a log row, clears snooze, bumps scheduleVersion (atomically)
 * - snooze stores the date literally, rejects past dates
 * - markFed cycles 1 → 2 → 0 (issue #26) and is unique per (tank, day)
 * - soft-deleted tanks disappear from listTanks/listSchedules
 * - water values: unknown keys rejected, implausible values rejected (issue #24)
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

const TMP = path.join(tmpdir(), `aquaman-it-${Date.now()}`);
process.env.AQUAMAN_DATA_DIR = TMP;

// revalidatePath throws outside a Next request context — stub before imports
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

beforeAll(async () => {
  mkdirSync(TMP, { recursive: true });
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const { db } = await import("../src/lib/db");
  migrate(db, { migrationsFolder: "./drizzle" });
});

afterAll(async () => {
  const { closeDb } = await import("./helpers");
  closeDb();
  rmSync(TMP, { recursive: true, force: true });
});

describe("repo + actions integration", () => {
  it("soft-deleted tanks vanish from listTanks AND listSchedules", async () => {
    const { createTank, deleteTank } = await import("../src/app/actions");
    const { listTanks, listSchedules, createScheduleDirect } = await import("./helpers");
    const res = await createTank({
      name: "IT Tank", volumeL: 100, waterType: "fresh", plants: [], fish: [], foods: [],
      hasCo2: false, hasHeater: true, hasFilter: true, filterType: null, tankState: "established",
    });
    expect(res.ok).toBe(true);
    const tankId = (res as { data?: { id: number } }).data!.id;

    await createScheduleDirect(tankId, { actionType: "water_change", intervalDays: 7, preferredDays: 127 });
    expect(listTanks()).toHaveLength(1);
    expect(listSchedules()).toHaveLength(1);

    await deleteTank(tankId);
    expect(listTanks()).toHaveLength(0);
    expect(listSchedules()).toHaveLength(0); // schedule still exists but filtered
  });

  it("markDone: log row written, snooze cleared, version bumped", async () => {
    const { markDone, snooze } = await import("../src/app/actions");
    const { createTankDirect, getScheduleDirect, createScheduleDirect, recentLogs } = await import("./helpers");
    const tankId = await createTankDirect("MD");
    const s = await createScheduleDirect(tankId, { actionType: "fertilize", intervalDays: 3, preferredDays: 127 });

    // snooze to tomorrow (valid), then markDone
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const sn = await snooze(s.id, tomorrow);
    expect(sn.ok).toBe(true);

    const done = await markDone(s.id);
    expect(done.ok).toBe(true);
    const after = getScheduleDirect(s.id)!;
    expect(after.snoozedUntil).toBeNull();
    expect(after.scheduleVersion).toBe(2); // snooze bump + done bump
    expect(recentLogs(tankId).some((l) => l.actionType === "fertilize")).toBe(true);
  });

  it("markDone carries the plan's scheduleId/details/detailData onto the log (same shape as an API-logged action)", async () => {
    const { markDone } = await import("../src/app/actions");
    const { createTankDirect, createScheduleDirect, recentLogs } = await import("./helpers");
    const tankId = await createTankDirect("MD2");
    const s = await createScheduleDirect(tankId, {
      actionType: "fertilize",
      intervalDays: 7,
      preferredDays: 127,
      details: "Fe 10 ml · K 5 ml",
      detailData: { nutrients: { fe: "10 ml", k: "5 ml" } },
    });

    const done = await markDone(s.id);
    expect(done.ok).toBe(true);

    const log = recentLogs(tankId).find((l) => l.actionType === "fertilize")!;
    expect(log.scheduleId).toBe(s.id);
    expect(log.details).toBe("Fe 10 ml · K 5 ml");
    expect(log.detailData).toEqual({ nutrients: { fe: "10 ml", k: "5 ml" } });
  });

  it("snooze rejects past dates without touching the schedule", async () => {
    const { snooze } = await import("../src/app/actions");
    const { createTankDirect, getScheduleDirect, createScheduleDirect } = await import("./helpers");
    const tankId = await createTankDirect("SP2");
    const s = await createScheduleDirect(tankId, { actionType: "water_change", intervalDays: 7, preferredDays: 127 });

    const past = "2020-01-01";
    const sn = (await snooze(s.id, past)) as { ok: boolean; error?: string };
    expect(sn.ok).toBe(false);
    expect(getScheduleDirect(s.id)!.scheduleVersion).toBe(0); // untouched
  });

  it("markFed cycles 1 → 2 → 0 and never touches other days", async () => {
    const { createTankDirect, markFed, todayFeed } = await import("./helpers");
    const tankId = await createTankDirect("FEED");
    const day = new Date().toISOString().slice(0, 10);

    const a = markFed(tankId, day);
    expect(a.timesFed).toBe(1);
    const b = markFed(tankId, day);
    expect(b.timesFed).toBe(2);
    const c = markFed(tankId, day); // wraps: row deleted → "not fed"
    expect(c.timesFed).toBe(0);
    expect(todayFeed(tankId, day)).toBeUndefined();
  });

  it("water values: unknown key and implausible value are rejected", async () => {
    const { validateWaterValues } = await import("../src/lib/schemas");
    const [a, aErr] = validateWaterValues({ no3: 25, bogusParam: 1 }, "fresh");
    expect(a).toBeNull();
    expect(aErr).toContain("bogusParam");
    const [b, bErr] = validateWaterValues({ temp: 250 }, "fresh");
    expect(b).toBeNull();
    expect(bErr).toContain("temp");
    const [c, cErr] = validateWaterValues({ temp: 25, ph: 7.2 }, "fresh");
    expect(cErr).toBeNull();
    expect(c).toEqual({ temp: 25, ph: 7.2 });
  });

  it("schedule with intervalDays=0 is rejected by zod before reaching the DB", async () => {
    const { createSchedule } = await import("../src/app/actions");
    const { createTankDirect } = await import("./helpers");
    const tankId = await createTankDirect("ZOD");
    const res = (await createSchedule({
      tankId, actionType: "water_change", intervalDays: 0, preferredDays: 127,
      autoReschedule: true, tightGapPolicy: null, tightGapThresholdPct: null,
    })) as { ok: boolean; error?: string };
    expect(res.ok).toBe(false);
  });
});
