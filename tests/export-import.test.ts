/**
 * Export/import tests (Phase 5 — PRD §5.9 DoD: "Export → fresh instance →
 * import → identical data state").
 *
 * Roundtrip strategy: seed a rich state (tanks incl. soft-deleted, schedules
 * with all policy fields, logs, tests incl. null values, feed logs, aiCalls)
 * → export → WIPE the DB by importing a minimal empty snapshot → import the
 * original → compare table-by-table. Also pins: no appSettings in export
 * (secret boundary), malformed imports rejected WITHOUT touching data,
 * broken references rejected, transactional rollback on hard failure.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { vi } from "vitest";

const TMP = path.join(tmpdir(), `aquaman-export-${Date.now()}`);
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

async function seedRichState() {
  const { db } = await import("../src/lib/db");
  const { tanks, schedules, maintenanceLogs, waterTests, feedLogs, aiCalls } = await import("../src/lib/db/schema");

  const live = db
    .insert(tanks)
    .values({
      name: "Export Tank", volumeL: 240, waterType: "fresh",
      plants: [{ name: "Vallisneria", qty: 5 }], fish: [{ species: "Guppy", qty: 12 }],
      hasCo2: true, hasHeater: true, hasFilter: true, filterType: "canister",
      tankState: "established", paramOverrides: { no3: { max: 20 } },
    })
    .returning()
    .get();

  const dead = db
    .insert(tanks)
    .values({ name: "Deleted Tank", volumeL: 60, waterType: "fresh" })
    .returning()
    .get();
  db.update(tanks).set({ deletedAt: "2026-08-01T00:00:00.000Z" }).where(eq(tanks.id, dead.id)).run();

  db.insert(schedules)
    .values({
      tankId: live.id, actionType: "water_change", intervalDays: 7, preferredDays: 96,
      lastDoneAt: "2026-08-20T10:00:00.000Z", snoozedUntil: null, snoozeSource: null,
      scheduleVersion: 3, tightGapPolicy: "fixed", tightGapThresholdPct: 60,
    })
    .run();
  db.insert(schedules)
    .values({ tankId: live.id, actionType: "fertilize", intervalDays: 2, preferredDays: 127 })
    .run();

  db.insert(maintenanceLogs).values({
    tankId: live.id, actionType: "water_change", doneAt: "2026-08-20T10:00:00.000Z",
    note: "40% + gravel vac", source: "user",
  }).run();
  db.insert(maintenanceLogs).values({
    tankId: live.id, actionType: "water_change", doneAt: "2026-08-13T09:00:00.000Z", source: "ai_proposed",
  }).run();

  db.insert(waterTests).values({
    tankId: live.id, measuredAt: "2026-08-22T08:00:00.000Z",
    values: { temp: 25, ph: 7.2, no3: 18, cl2: null }, note: "morning",
  }).run();

  db.insert(feedLogs).values({ tankId: live.id, day: "2026-08-23", fedAt: "2026-08-23T07:30:00.000Z", timesFed: 2 }).run();

  db.insert(aiCalls).values({
    day: "2026-08-23", provider: "zai", model: "glm-4.6",
    promptTokens: 1200, completionTokens: 340, costEstimateMicros: 1450, purpose: "coach",
  }).run();

  return { liveId: live.id, deadId: dead.id };
}

import { eq } from "drizzle-orm";

describe("export snapshot", () => {
  it("contains all data tables but NEVER appSettings (secret boundary)", async () => {
    const { buildExportSnapshot } = await import("../src/lib/export");
    const snap = buildExportSnapshot(new Date("2026-08-24T12:00:00Z"));
    expect(snap.app).toBe("aquaman");
    expect(snap.format).toBe(1);
    expect(snap).not.toHaveProperty("appSettings");
    expect(snap).not.toHaveProperty("settings");
    // secrets never leak via stringified form either
    const str = JSON.stringify(snap);
    expect(str).not.toContain("icsToken");
  });
});

describe("import roundtrip (DoD: export → wipe → import → identical state)", () => {
  it("full roundtrip preserves every row byte-for-byte", async () => {
    const { buildExportSnapshot, importSnapshot } = await import("../src/lib/export");
    const { db } = await import("../src/lib/db");
    const { tanks, schedules, maintenanceLogs, waterTests, feedLogs, aiCalls } = await import("../src/lib/db/schema");

    await seedRichState();
    const snapshot = buildExportSnapshot();

    // wipe: import an EMPTY valid snapshot
    const empty = {
      format: 1, app: "aquaman",
      tanks: [], schedules: [], maintenanceLogs: [], waterTests: [], feedLogs: [], aiCalls: [],
    };
    importSnapshot(empty);
    expect(db.select().from(tanks).all()).toHaveLength(0);

    // restore
    const result = importSnapshot(snapshot);
    expect(result.tanks).toBe(2);
    expect(result.schedules).toBe(2);
    expect(result.maintenanceLogs).toBe(2);
    expect(result.waterTests).toBe(1);
    expect(result.feedLogs).toBe(1);
    expect(result.aiCalls).toBe(1);

    // compare table-by-table (select order is stable by rowid → JSON compare)
    expect(db.select().from(tanks).all()).toEqual((snapshot.tanks as typeof tanks.$inferSelect[]));
    expect(db.select().from(schedules).all()).toEqual(snapshot.schedules);
    expect(db.select().from(maintenanceLogs).all()).toEqual(snapshot.maintenanceLogs);
    expect(db.select().from(waterTests).all()).toEqual(snapshot.waterTests);
    expect(db.select().from(feedLogs).all()).toEqual(snapshot.feedLogs);
    expect(db.select().from(aiCalls).all()).toEqual(snapshot.aiCalls);
  });

  it("malformed snapshot → error, existing data UNTOUCHED", async () => {
    const { importSnapshot } = await import("../src/lib/export");
    const { db } = await import("../src/lib/db");
    const { tanks } = await import("../src/lib/db/schema");
    const before = db.select().from(tanks).all();

    expect(() => importSnapshot({ garbage: true })).toThrow(/Invalid snapshot/);
    expect(() => importSnapshot({ format: 99, app: "aquaman", tanks: [] })).toThrow(/format/);
    // negative volume must fail zod
    expect(() =>
      importSnapshot({
        format: 1, app: "aquaman",
        tanks: [{ id: 1, name: "x", volumeL: -5, waterType: "fresh", photoPath: null, plants: [], fish: [], hasCo2: false, hasHeater: false, hasFilter: true, filterType: null, tankState: "established", paramOverrides: {}, createdAt: "2026-08-01", deletedAt: null }],
        schedules: [], maintenanceLogs: [], waterTests: [], feedLogs: [], aiCalls: [],
      }),
    ).toThrow();

    expect(db.select().from(tanks).all()).toEqual(before);
  });

  it("broken references (schedule → missing tank) rejected before any write", async () => {
    const { importSnapshot } = await import("../src/lib/export");
    const { db } = await import("../src/lib/db");
    const { tanks } = await import("../src/lib/db/schema");
    const before = db.select().from(tanks).all();

    expect(() =>
      importSnapshot({
        format: 1, app: "aquaman",
        tanks: [{ id: 1, name: "x", volumeL: 60, waterType: "fresh", photoPath: null, plants: [], fish: [], hasCo2: false, hasHeater: false, hasFilter: true, filterType: null, tankState: "established", paramOverrides: {}, createdAt: "2026-08-01", deletedAt: null }],
        schedules: [{ id: 1, tankId: 999, actionType: "water_change", intervalDays: 7, preferredDays: 127, autoReschedule: true, lastDoneAt: null, snoozedUntil: null, snoozeSource: null, scheduleVersion: 0, tightGapPolicy: null, tightGapThresholdPct: null, createdAt: "2026-08-01", updatedAt: "2026-08-01", active: true }],
        maintenanceLogs: [], waterTests: [], feedLogs: [], aiCalls: [],
      }),
    ).toThrow(/references missing tank/);

    expect(db.select().from(tanks).all()).toEqual(before);
  });

  it("rejects an actionType outside the standard-events catalog", async () => {
    const { importSnapshot } = await import("../src/lib/export");
    expect(() =>
      importSnapshot({
        format: 1, app: "aquaman",
        tanks: [{ id: 1, name: "x", volumeL: 60, waterType: "fresh", photoPath: null, plants: [], fish: [], hasCo2: false, hasHeater: false, hasFilter: true, filterType: null, tankState: "established", paramOverrides: {}, createdAt: "2026-08-01", deletedAt: null }],
        schedules: [{ id: 1, tankId: 1, actionType: "kaffee_kochen", intervalDays: 7, preferredDays: 127, autoReschedule: true, lastDoneAt: null, snoozedUntil: null, snoozeSource: null, scheduleVersion: 0, tightGapPolicy: null, tightGapThresholdPct: null, createdAt: "2026-08-01", updatedAt: "2026-08-01", active: true }],
        maintenanceLogs: [], waterTests: [], feedLogs: [], aiCalls: [],
      }),
    ).toThrow(/Invalid snapshot/);
  });

  it("broken references (log → missing schedule) rejected before any write", async () => {
    const { importSnapshot } = await import("../src/lib/export");
    expect(() =>
      importSnapshot({
        format: 1, app: "aquaman",
        tanks: [{ id: 1, name: "x", volumeL: 60, waterType: "fresh", photoPath: null, plants: [], fish: [], hasCo2: false, hasHeater: false, hasFilter: true, filterType: null, tankState: "established", paramOverrides: {}, createdAt: "2026-08-01", deletedAt: null }],
        schedules: [],
        maintenanceLogs: [{ id: 1, tankId: 1, actionType: "water_change", doneAt: "2026-08-01T00:00:00.000Z", note: null, source: "user", scheduleId: 999, details: null, detailData: null }],
        waterTests: [], feedLogs: [], aiCalls: [],
      }),
    ).toThrow(/references missing schedule/);
  });

  it("rejects wrong app / future format versions explicitly", async () => {
    const { importSnapshot } = await import("../src/lib/export");
    expect(() =>
      importSnapshot({ format: 1, app: "other-app", tanks: [], schedules: [], maintenanceLogs: [], waterTests: [], feedLogs: [], aiCalls: [] }),
    ).toThrow();
  });
});
