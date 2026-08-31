/**
 * Structured care plans (issue #42): duplicate guard, formatDetailData,
 * detailData persistence, export roundtrip with the new fields.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { vi } from "vitest";

const TMP = path.join(tmpdir(), `aquaman-plans42-${Date.now()}`);
process.env.AQUAMAN_DATA_DIR = TMP;

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

describe("formatDetailData", () => {
  it("water_change: percent with liters", async () => {
    const { formatDetailData } = await import("../src/lib/domain/plan-structure");
    expect(formatDetailData("water_change", { percent: 30 }, 60)).toBe("30 % (18 L of 60 L)");
    expect(formatDetailData("water_change", { percent: 50 }, 240)).toBe("50 % (120 L of 240 L)");
    expect(formatDetailData("water_change", { percent: 0 }, 60)).toBe("");
  });

  it("fertilize: nutrient doses joined", async () => {
    const { formatDetailData } = await import("../src/lib/domain/plan-structure");
    expect(formatDetailData("fertilize", { nutrients: { fe: "10 ml", k: "5 ml" } })).toBe("Fe 10 ml · K 5 ml");
  });

  it("feed: amount per food", async () => {
    const { formatDetailData } = await import("../src/lib/domain/plan-structure");
    expect(formatDetailData("feed", { foods: { Flakes: "1 pinch", Frozen: "2 cubes" } })).toBe("Flakes 1 pinch · Frozen 2 cubes");
  });

  it("water_top_up: liters", async () => {
    const { formatDetailData } = await import("../src/lib/domain/plan-structure");
    expect(formatDetailData("water_top_up", { liters: 12 })).toBe("12 L");
    expect(formatDetailData("water_top_up", { liters: 0 })).toBe("");
  });

  it("standard types: exactly the five", async () => {
    const { STANDARD_PLAN_TYPES, isStandardPlanType } = await import("../src/lib/domain/plan-structure");
    expect(STANDARD_PLAN_TYPES).toHaveLength(5);
    expect(isStandardPlanType("glass_clean")).toBe(false);
    expect(isStandardPlanType("water_change")).toBe(true);
  });
});

describe("duplicate guard (one plan per type per tank)", () => {
  it("createSchedule blocks a second water_change for the same tank", async () => {
    const { createSchedule, createTank } = await import("../src/app/actions");
    const t = await createTank({ name: "GuardT", volumeL: 60, waterType: "fresh", plants: [], fish: [], foods: [], hasCo2: false, hasHeater: false, hasFilter: true, filterType: null, tankState: "established" });
    expect(t.ok).toBe(true);
    const tankId = (t as { data?: { id: number } }).data!.id;

    const first = await createSchedule({ tankId, actionType: "water_change", intervalDays: 7, preferredDays: 127, autoReschedule: true, tightGapPolicy: null, tightGapThresholdPct: null });
    expect(first.ok).toBe(true);

    const dupe = (await createSchedule({ tankId, actionType: "water_change", intervalDays: 14, preferredDays: 127, autoReschedule: true, tightGapPolicy: null, tightGapThresholdPct: null })) as { ok: boolean; error?: string };
    expect(dupe.ok).toBe(false);
    expect(dupe.error).toContain("already has");

    // custom types are exempt
    const custom = await createSchedule({ tankId, actionType: "glass_clean", intervalDays: 14, preferredDays: 127, autoReschedule: true, tightGapPolicy: null, tightGapThresholdPct: null });
    expect(custom.ok).toBe(true);
  });

  it("updateSchedule blocks renaming onto an occupied standard type", async () => {
    const { createSchedule, updateSchedule, createTank } = await import("../src/app/actions");
    const t = await createTank({ name: "GuardU", volumeL: 60, waterType: "fresh", plants: [], fish: [], foods: [], hasCo2: false, hasHeater: false, hasFilter: true, filterType: null, tankState: "established" });
    const tankId = (t as { data?: { id: number } }).data!.id;
    await createSchedule({ tankId, actionType: "fertilize", intervalDays: 7, preferredDays: 127, autoReschedule: true, tightGapPolicy: null, tightGapThresholdPct: null });
    const wc = await createSchedule({ tankId, actionType: "water_change", intervalDays: 7, preferredDays: 127, autoReschedule: true, tightGapPolicy: null, tightGapThresholdPct: null });
    const wcId = (wc as { data?: { id: number } }).data!.id;

    const rename = (await updateSchedule(wcId, { tankId, actionType: "fertilize", intervalDays: 5, preferredDays: 127, autoReschedule: true, tightGapPolicy: null, tightGapThresholdPct: null })) as { ok: boolean };
    expect(rename.ok).toBe(false);
  });

  it("applyProposal respects the guard (skips instead of writing)", async () => {
    const { applyProposal } = await import("../src/app/actions-ai");
    const { createTank, createSchedule } = await import("../src/app/actions");
    const t = await createTank({ name: "GuardAI", volumeL: 60, waterType: "fresh", plants: [], fish: [], foods: [], hasCo2: false, hasHeater: false, hasFilter: true, filterType: null, tankState: "established" });
    const tankId = (t as { data?: { id: number } }).data!.id;
    await createSchedule({ tankId, actionType: "feed", intervalDays: 1, preferredDays: 127, autoReschedule: true, tightGapPolicy: null, tightGapThresholdPct: null });

    const res = await applyProposal({
      rationale: "r",
      changes: [{ kind: "create", tankId, actionType: "feed", intervalDays: 2, preferredDays: 127, details: "Flakes 1 pinch" }],
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data!.applied).toHaveLength(0);
      expect(res.data!.skipped[0].reason).toContain("already exists");
    }
  });
});

describe("detailData persistence + export", () => {
  it("createSchedule stores detailData; export/import roundtrip keeps it", async () => {
    const { createSchedule, createTank } = await import("../src/app/actions");
    const { buildExportSnapshot, importSnapshot } = await import("../src/lib/export");
    const { db } = await import("../src/lib/db");
    const { schedules } = await import("../src/lib/db/schema");

    const t = await createTank({ name: "DetailT", volumeL: 120, waterType: "fresh", plants: [], fish: [], foods: [{ name: "Flakes", amount: "1", unit: "pinch" }], hasCo2: true, hasHeater: false, hasFilter: true, filterType: null, tankState: "established" });
    const tankId = (t as { data?: { id: number } }).data!.id;
    const res = await createSchedule({
      tankId, actionType: "water_change", intervalDays: 7, preferredDays: 96,
      autoReschedule: true, tightGapPolicy: null, tightGapThresholdPct: null,
      details: "30 % (36 L of 120 L)", detailData: { percent: 30 },
    });
    expect(res.ok).toBe(true);

    const row = db.select().from(schedules).all().find((x) => x.tankId === tankId);
    expect((row?.detailData as { percent: number })?.percent).toBe(30);

    const snap = buildExportSnapshot();
    importSnapshot(snap);
    const restored = db.select().from(schedules).all().find((x) => x.tankId === tankId);
    expect((restored?.detailData as { percent: number })?.percent).toBe(30);
  });

  it("v0.2 export (no detailData/foods) still imports", async () => {
    const { importSnapshot } = await import("../src/lib/export");
    expect(() =>
      importSnapshot({
        format: 1, app: "aquaman",
        tanks: [{ id: 777, name: "Old", volumeL: 60, waterType: "fresh", photoPath: null, plants: [], fish: [], hasCo2: false, hasHeater: false, hasFilter: true, filterType: null, tankState: "established", paramOverrides: {}, createdAt: "2026-08-01", deletedAt: null }],
        schedules: [{ id: 777, tankId: 777, actionType: "water_change", intervalDays: 7, preferredDays: 127, autoReschedule: true, lastDoneAt: null, snoozedUntil: null, snoozeSource: null, scheduleVersion: 0, tightGapPolicy: null, tightGapThresholdPct: null, createdAt: "2026-08-01", updatedAt: "2026-08-01", active: true }],
        maintenanceLogs: [], waterTests: [], feedLogs: [], aiCalls: [],
      }),
    ).not.toThrow();
  });
});
