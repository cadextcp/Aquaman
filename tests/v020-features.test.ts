/**
 * v0.2.0 feature tests (issues #30–#36): endsOn in scheduler/ICS, undoLastDone,
 * adjustFeedToday, water test update/delete, proposal details.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { vi } from "vitest";

const TMP = path.join(tmpdir(), `aquaman-v02-${Date.now()}`);
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

const T0 = "2026-08-24";

function sched(over: Record<string, unknown> = {}) {
  return {
    intervalDays: 7,
    preferredDays: 127,
    autoReschedule: false,
    lastDoneAt: null,
    snoozedUntil: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...over,
  };
}

describe("scheduler endsOn", () => {
  it("emits occurrences up to and including endsOn, none after", async () => {
    const { occurrenceDetailsInRange } = await import("../src/lib/domain/scheduler");
    const s = sched({ endsOn: "2026-08-20" });
    const now = new Date("2026-08-24T12:00:00Z");
    const occs = occurrenceDetailsInRange(s, "2026-08-01", "2026-09-30", now);
    expect(occs.every((o) => o.plannedFor <= "2026-08-20")).toBe(true);
    expect(occs.length).toBeGreaterThan(0);
  });

  it("hasEnded: inclusive on the endsOn day, true after", async () => {
    const { hasEnded } = await import("../src/lib/domain/scheduler");
    const s = sched({ endsOn: "2026-08-20" });
    expect(hasEnded(s, "2026-08-20")).toBe(false);
    expect(hasEnded(s, "2026-08-21")).toBe(true);
  });

  it("no endsOn → unchanged behavior", async () => {
    const { hasEnded } = await import("../src/lib/domain/scheduler");
    expect(hasEnded(sched(), "2030-01-01")).toBe(false);
  });
});

describe("ICS details + endsOn (issues #30/#31)", () => {
  it("DESCRIPTION carries details", async () => {
    const { buildIcsFeed } = await import("../src/lib/domain/ics");
    const feed = buildIcsFeed(
      [
        {
          id: 1, tankId: 1, actionType: "water_change", tankName: "T", scheduleVersion: 0,
          updatedAt: "2026-08-01T00:00:00Z", active: true,
          intervalDays: 7, preferredDays: 127, autoReschedule: false,
          lastDoneAt: null, snoozedUntil: null, createdAt: "2026-08-01T00:00:00Z",
          details: "30 L of 60 L (50%) water change",
        },
      ],
      new Date("2026-08-24T12:00:00Z"),
    );
    expect(feed).toContain("DESCRIPTION:30 L of 60 L (50%) water change");
  });

  it("ended schedules emit no VEVENTs", async () => {
    const { buildIcsFeed } = await import("../src/lib/domain/ics");
    const feed = buildIcsFeed(
      [
        {
          id: 1, tankId: 1, actionType: "water_change", tankName: "T", scheduleVersion: 0,
          updatedAt: "2026-08-01T00:00:00Z", active: true,
          intervalDays: 7, preferredDays: 127, autoReschedule: false,
          lastDoneAt: null, snoozedUntil: null, createdAt: "2026-08-01T00:00:00Z",
          endsOn: "2026-08-10",
        },
      ],
      new Date("2026-08-24T12:00:00Z"),
    );
    expect(feed).not.toContain("BEGIN:VEVENT");
  });
});

describe("undoLastDone (issue #34)", () => {
  it("deletes the newest log, restores previous lastDoneAt, bumps version", async () => {
    const { undoLastDone, markDone } = await import("../src/app/actions");
    const { db } = await import("../src/lib/db");
    const { tanks, schedules, maintenanceLogs } = await import("../src/lib/db/schema");
    const { eq, and } = await import("drizzle-orm");

    const tank = db.insert(tanks).values({ name: "UndoT", volumeL: 60, waterType: "fresh" }).returning().get();
    const s = db.insert(schedules).values({ tankId: tank.id, actionType: "water_change", intervalDays: 7, preferredDays: 127 }).returning().get();

    // two completions
    await markDone(s.id);
    db.update(maintenanceLogs).set({ doneAt: "2026-08-10T10:00:00Z" }).where(eq(maintenanceLogs.id, db.select().from(maintenanceLogs).all()[0].id)).run();
    await markDone(s.id);

    const logsBefore = db.select().from(maintenanceLogs).all().length;
    expect(logsBefore).toBe(2);

    const res = await undoLastDone(s.id);
    expect(res.ok).toBe(true);

    const after = db.select().from(schedules).where(eq(schedules.id, s.id)).get()!;
    expect(after.lastDoneAt).toBe("2026-08-10T10:00:00Z"); // restored previous
    expect(db.select().from(maintenanceLogs).all().length).toBe(1);
    expect(after.scheduleVersion).toBeGreaterThan(0);
  });

  it("undo the very first completion → lastDoneAt null", async () => {
    const { undoLastDone, markDone } = await import("../src/app/actions");
    const { db } = await import("../src/lib/db");
    const { tanks, schedules } = await import("../src/lib/db/schema");
    const { eq } = await import("drizzle-orm");

    const tank = db.insert(tanks).values({ name: "UndoFirst", volumeL: 60, waterType: "fresh" }).returning().get();
    const s = db.insert(schedules).values({ tankId: tank.id, actionType: "fertilize", intervalDays: 3, preferredDays: 127 }).returning().get();

    await markDone(s.id);
    const res = await undoLastDone(s.id);
    expect(res.ok).toBe(true);
    expect(db.select().from(schedules).where(eq(schedules.id, s.id)).get()!.lastDoneAt).toBeNull();
  });

  it("nothing to undo → error, no crash", async () => {
    const { undoLastDone } = await import("../src/app/actions");
    const { db } = await import("../src/lib/db");
    const { tanks, schedules } = await import("../src/lib/db/schema");
    const tank = db.insert(tanks).values({ name: "UndoEmpty", volumeL: 60, waterType: "fresh" }).returning().get();
    const s = db.insert(schedules).values({ tankId: tank.id, actionType: "filter_clean", intervalDays: 14, preferredDays: 127 }).returning().get();
    const res = (await undoLastDone(s.id)) as { ok: boolean; error?: string };
    expect(res.ok).toBe(false);
  });
});

describe("adjustFeedToday ± (issue #32)", () => {
  it("increments, decrements, deletes at 0, caps at 5", async () => {
    const { adjustFeedToday } = await import("../src/app/actions");
    const { db } = await import("../src/lib/db");
    const { tanks } = await import("../src/lib/db/schema");
    const { markFed, todayFeed } = await import("../src/lib/repo");

    const tank = db.insert(tanks).values({ name: "FeedT", volumeL: 60, waterType: "fresh" }).returning().get();
    // the app keys feed rows on the LOCAL day (AQUAMAN_TIMEZONE), so reading
    // them back by the UTC day makes this test fail every night between
    // 22:00 and 24:00 UTC — bug hotspot #1, in the test rather than the code
    const { today } = await import("../src/lib/domain/dates");
    const day = today();

    let r = await adjustFeedToday(tank.id, 1);
    expect(r.ok && r.data!.timesFed).toBe(1);
    r = await adjustFeedToday(tank.id, 1);
    expect(r.ok && r.data!.timesFed).toBe(2);
    r = await adjustFeedToday(tank.id, -1);
    expect(r.ok && r.data!.timesFed).toBe(1);
    r = await adjustFeedToday(tank.id, -1);
    expect(r.ok && r.data!.timesFed).toBe(0);
    expect(todayFeed(tank.id, day)).toBeUndefined(); // row deleted at 0

    // cap at 5
    for (let i = 0; i < 8; i++) await adjustFeedToday(tank.id, 1);
    expect(todayFeed(tank.id, day)!.timesFed).toBe(5);
  });
});

describe("water test update/delete (issue #35)", () => {
  it("updates values and deletes the row", async () => {
    const { updateWaterTest, deleteWaterTest, logWaterTest } = await import("../src/app/actions");
    const { db } = await import("../src/lib/db");
    const { tanks, waterTests } = await import("../src/lib/db/schema");

    const tank = db.insert(tanks).values({ name: "WTT", volumeL: 60, waterType: "fresh" }).returning().get();
    const created = await logWaterTest({ tankId: tank.id, values: { temp: 25, ph: 7.0 } });
    expect(created.ok).toBe(true);

    const row = db.select().from(waterTests).all()[0];

    const up = await updateWaterTest({ id: row.id, tankId: tank.id, values: { temp: 26, ph: 7.2 }, measuredAt: row.measuredAt });
    expect(up.ok).toBe(true);
    const after = db.select().from(waterTests).all()[0];
    expect(after.values["temp"]).toBe(26);

    const del = await deleteWaterTest(row.id);
    expect(del.ok).toBe(true);
    expect(db.select().from(waterTests).all().length).toBe(0);
  });

  it("edit rejects implausible values (validation still applies)", async () => {
    const { updateWaterTest, logWaterTest } = await import("../src/app/actions");
    const { db } = await import("../src/lib/db");
    const { tanks, waterTests } = await import("../src/lib/db/schema");

    const tank = db.insert(tanks).values({ name: "WTV", volumeL: 60, waterType: "fresh" }).returning().get();
    await logWaterTest({ tankId: tank.id, values: { temp: 25 } });
    const row = db.select().from(waterTests).all()[0];

    const bad = (await updateWaterTest({ id: row.id, tankId: tank.id, values: { temp: 250 }, measuredAt: row.measuredAt })) as { ok: boolean; error?: string };
    expect(bad.ok).toBe(false);
  });
});

describe("proposal details (issue #36)", () => {
  it("zod accepts details on create and adjust; rejects >300 chars", async () => {
    const { parseProposal } = await import("../src/lib/ai/proposal");
    const okCreate = parseProposal({
      rationale: "nitrate high",
      changes: [{ kind: "create", tankId: 1, actionType: "fertilize", intervalDays: 7, preferredDays: 127, details: "10 ml iron fertilizer (verify against product label)" }],
    });
    expect(okCreate).not.toBeNull();
    expect(okCreate!.changes[0].details).toContain("verify");

    const okAdjust = parseProposal({
      rationale: "x",
      changes: [{ kind: "adjust", scheduleId: 1, intervalDays: 5, details: "30 L of 60 L" }],
    });
    expect(okAdjust).not.toBeNull();

    const tooLong = parseProposal({
      rationale: "x",
      changes: [{ kind: "adjust", scheduleId: 1, intervalDays: 5, details: "x".repeat(301) }],
    });
    expect(tooLong).toBeNull();
  });

  it("applyProposal writes details into the schedule", async () => {
    const { applyProposal } = await import("../src/app/actions-ai");
    const { db } = await import("../src/lib/db");
    const { tanks, schedules } = await import("../src/lib/db/schema");
    const tank = db.insert(tanks).values({ name: "AiD", volumeL: 120, waterType: "fresh" }).returning().get();

    const res = await applyProposal({
      rationale: "r",
      changes: [{ kind: "create", tankId: tank.id, actionType: "water_change", intervalDays: 7, preferredDays: 127, details: "60 L of 120 L (50%)" }],
    });
    expect(res.ok).toBe(true);
    const row = db.select().from(schedules).all().pop()!;
    expect(row.details).toBe("60 L of 120 L (50%)");
  });
});

describe("schedule details/endsOn roundtrip via export (issues #30/#31)", () => {
  it("survives export → import with the new fields", async () => {
    const { buildExportSnapshot, importSnapshot } = await import("../src/lib/export");
    const { db } = await import("../src/lib/db");
    const { tanks, schedules } = await import("../src/lib/db/schema");

    const tank = db.insert(tanks).values({ name: "ExpV02", volumeL: 60, waterType: "fresh" }).returning().get();
    db.insert(schedules).values({
      tankId: tank.id, actionType: "fertilize", intervalDays: 7, preferredDays: 127,
      details: "5 ml macro", endsOn: "2026-12-31",
    }).run();

    const snap = buildExportSnapshot();
    importSnapshot({ ...snap, tanks: snap.tanks, schedules: snap.schedules });
    const restored = db.select().from(schedules).all().find((s) => s.details === "5 ml macro");
    expect(restored?.endsOn).toBe("2026-12-31");
  });

  it("v0.1.0 exports (no details/endsOn keys) still import", async () => {
    const { importSnapshot } = await import("../src/lib/export");
    // strip the new keys to simulate a v0.1.0 snapshot
    const legacy = {
      format: 1, app: "aquaman",
      tanks: [{ id: 901, name: "Legacy", volumeL: 60, waterType: "fresh", photoPath: null, plants: [], fish: [], hasCo2: false, hasHeater: false, hasFilter: true, filterType: null, tankState: "established", paramOverrides: {}, createdAt: "2026-08-01", deletedAt: null }],
      schedules: [{ id: 901, tankId: 901, actionType: "water_change", intervalDays: 7, preferredDays: 127, autoReschedule: true, lastDoneAt: null, snoozedUntil: null, snoozeSource: null, scheduleVersion: 0, tightGapPolicy: null, tightGapThresholdPct: null, createdAt: "2026-08-01", updatedAt: "2026-08-01", active: true }],
      maintenanceLogs: [], waterTests: [], feedLogs: [], aiCalls: [],
    };
    expect(() => importSnapshot(legacy)).not.toThrow();
  });
});

describe("deleteSchedule (owner follow-up)", () => {
  it("removes the schedule row; tank/logs stay", async () => {
    const { deleteSchedule, markDone } = await import("../src/app/actions");
    const { db } = await import("../src/lib/db");
    const { tanks, schedules, maintenanceLogs } = await import("../src/lib/db/schema");
    const { eq } = await import("drizzle-orm");

    const tank = db.insert(tanks).values({ name: "DelS", volumeL: 60, waterType: "fresh" }).returning().get();
    const s = db.insert(schedules).values({ tankId: tank.id, actionType: "water_change", intervalDays: 7, preferredDays: 127 }).returning().get();
    await markDone(s.id);

    const res = await deleteSchedule(s.id);
    expect(res.ok).toBe(true);

    expect(db.select().from(schedules).where(eq(schedules.id, s.id)).all()).toHaveLength(0);
    // history survives
    const logs = db.select().from(maintenanceLogs).where(eq(maintenanceLogs.tankId, tank.id)).all();
    expect(logs.length).toBe(1);
    // tank survives
    expect(db.select().from(tanks).where(eq(tanks.id, tank.id)).get()).toBeDefined();
  });

  it("unknown id → error, nothing thrown", async () => {
    const { deleteSchedule } = await import("../src/app/actions");
    const res = (await deleteSchedule(999999)) as { ok: boolean };
    expect(res.ok).toBe(false);
  });
});

describe("global settings (issues #39/#40)", () => {
  it("tight-gap defaults round-trip through appSettings", async () => {
    const { getGlobalSettings, saveGlobalSettings } = await import("../src/lib/settings");
    saveGlobalSettings({ tightGapPolicy: "fixed", tightGapThresholdPct: 40 });
    const g = getGlobalSettings();
    expect(g.tightGapPolicy).toBe("fixed");
    expect(g.tightGapThresholdPct).toBe(40);
    // restore defaults
    saveGlobalSettings({ tightGapPolicy: "suppress", tightGapThresholdPct: 50 });
  });

  it("language round-trips and is readable via getLocale()", async () => {
    const { getGlobalSettings, saveGlobalSettings, getLocale } = await import("../src/lib/settings");
    saveGlobalSettings({ locale: "de" });
    expect(getGlobalSettings().locale).toBe("de");
    expect(getLocale()).toBe("de");
    saveGlobalSettings({ locale: "en" });
    expect(getLocale()).toBe("en");
  });

  it("saving one settings block does NOT reset another (merge, not replace)", async () => {
    // the bug this pins: /more saves language and tight-gap in separate forms —
    // a full replace would silently reset the language when the other form saves
    const { getGlobalSettings, saveGlobalSettings } = await import("../src/lib/settings");
    saveGlobalSettings({ locale: "de", tightGapPolicy: "fixed", tightGapThresholdPct: 40 });

    saveGlobalSettings({ tightGapPolicy: "suppress", tightGapThresholdPct: 50 });
    expect(getGlobalSettings().locale, "language survived a tight-gap save").toBe("de");

    saveGlobalSettings({ locale: "en" });
    const after = getGlobalSettings();
    expect(after.tightGapPolicy, "tight-gap survived a language save").toBe("suppress");
    expect(after.tightGapThresholdPct).toBe(50);
  });

  it("a legacy row without a language still parses (keeps the rest of the settings)", async () => {
    const { getGlobalSettings } = await import("../src/lib/settings");
    const { db } = await import("../src/lib/db");
    const { appSettings } = await import("../src/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    const legacy = { tightGapPolicy: "fixed", tightGapThresholdPct: 33 };
    db.insert(appSettings).values({ key: "appSettings.v1", value: legacy as never })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: legacy as never } }).run();

    const g = getGlobalSettings();
    expect(g.tightGapThresholdPct, "pre-language row must not fall back to ALL defaults").toBe(33);
    expect(g.locale).toBe("en");
    db.delete(appSettings).where(eq(appSettings.key, "appSettings.v1")).run();
  });

  it("corrupt settings row falls back to defaults", async () => {
    const { getGlobalSettings, DEFAULT_GLOBAL_SETTINGS } = await import("../src/lib/settings");
    const { db } = await import("../src/lib/db");
    const { appSettings } = await import("../src/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    db.insert(appSettings).values({ key: "appSettings.v1", value: { nonsense: true } as never })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: { nonsense: true } as never } }).run();
    expect(getGlobalSettings()).toEqual(DEFAULT_GLOBAL_SETTINGS);
    db.delete(appSettings).where(eq(appSettings.key, "appSettings.v1")).run();
  });

  it("AI settings: valid saves, invalid rejected", async () => {
    const { saveAiSettings, getAiSettings } = await import("../src/lib/settings");
    const saved = saveAiSettings({
      provider: "kimi", baseUrl: "https://api.moonshot.ai/api/anthropic",
      model: "kimi-k2", maxCallsPerDay: 30, maxTokensPerDay: 300000,
    });
    expect(saved.provider).toBe("kimi");
    expect(getAiSettings()!.model).toBe("kimi-k2");
    expect(() => saveAiSettings({ provider: "custom", baseUrl: "not-a-url", model: "x", maxCallsPerDay: 5, maxTokensPerDay: 5000 })).toThrow();
    // cleanup
    const { db } = await import("../src/lib/db");
    const { appSettings } = await import("../src/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    db.delete(appSettings).where(eq(appSettings.key, "aiSettings.v1")).run();
  });

  it("AI config precedence: settings override env", async () => {
    process.env.AQUAMAN_AI_API_KEY = "k";
    process.env.AQUAMAN_AI_MODEL = "env-model";
    process.env.AQUAMAN_AI_MAX_CALLS_PER_DAY = "5";
    const { saveAiSettings } = await import("../src/lib/settings");
    saveAiSettings({
      provider: "zai", baseUrl: "https://api.z.ai/api/anthropic",
      model: "glm-5.3", maxCallsPerDay: 33, maxTokensPerDay: 123456,
    });
    const { getAiConfig, invalidateAiSettingsCache } = await import("../src/lib/ai/config");
    invalidateAiSettingsCache(); // the save route does exactly this
    const cfg = getAiConfig();
    expect(cfg!.model).toBe("glm-5.3");
    expect(cfg!.maxCallsPerDay).toBe(33);
    expect(cfg!.baseUrl).toBe("https://api.z.ai/api/anthropic");
    // cleanup
    const { db } = await import("../src/lib/db");
    const { appSettings } = await import("../src/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    db.delete(appSettings).where(eq(appSettings.key, "aiSettings.v1")).run();
    invalidateAiSettingsCache();
    delete process.env.AQUAMAN_AI_API_KEY;
    delete process.env.AQUAMAN_AI_MODEL;
    delete process.env.AQUAMAN_AI_MAX_CALLS_PER_DAY;
  });
});
