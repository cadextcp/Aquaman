/**
 * Feeding is a daily habit, not a care plan (owner report).
 *
 * The bug: the standard-events catalog made `feed` a schedulable standard type,
 * so a feed PLAN could be created (tank page recommendation, coach proposal,
 * plan editor). But every feeding is written to `feed_logs` and nothing writes
 * `schedules.lastDoneAt` for it — so the plan was unsatisfiable by construction:
 * it re-appeared in the care queue every single day and its backlog grew by one
 * day per day no matter how much the user fed. Two tanks showed two different
 * lies ("2 days behind" vs "due today") purely because their plans had been
 * created on different days.
 *
 * These tests pin the fix from both ends: no new feed plan can be created (any
 * route), an existing one is retired, and what the user actually wanted —
 * "when did I last feed?" — is answered from feed_logs.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdirSync, rmSync, readFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

const TMP = path.join(tmpdir(), `aquaman-feedplan-${Date.now()}`);
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

const PLAN = { intervalDays: 1, preferredDays: 127, autoReschedule: true, tightGapPolicy: null, tightGapThresholdPct: null };

describe("feed is not a schedulable type", () => {
  it("the catalog says so, and every derived list follows", async () => {
    const { SCHEDULABLE_ACTION_TYPES, actionTypeDef } = await import("../src/lib/domain/action-types");
    const { STANDARD_PLAN_TYPES } = await import("../src/lib/domain/plan-structure");
    expect(actionTypeDef("feed")?.schedulable).toBe(false);
    expect(SCHEDULABLE_ACTION_TYPES).not.toContain("feed");
    // the tank page's "missing plans" checklist — it used to recommend one
    expect(STANDARD_PLAN_TYPES).not.toContain("feed");
    // still a catalog member: old logs/plans must keep rendering
    expect(actionTypeDef("feed")?.label).toBe("Feed");
  });

  it("createSchedule rejects it (zod, the first line of defence)", async () => {
    const { createTankDirect } = await import("./helpers");
    const { createSchedule } = await import("../src/app/actions");
    const tankId = await createTankDirect("No Feed Plan");

    const res = (await createSchedule({ tankId, actionType: "feed", ...PLAN })) as { ok: boolean };
    expect(res.ok).toBe(false);
    // the types that ARE plans still work — this is a targeted rejection
    const ok = (await createSchedule({ tankId, actionType: "water_change", ...PLAN })) as { ok: boolean };
    expect(ok.ok).toBe(true);
  });

  it("updateSchedule cannot rename an existing plan to feed", async () => {
    const { createTankDirect, getScheduleDirect } = await import("./helpers");
    const { createSchedule, updateSchedule } = await import("../src/app/actions");
    const tankId = await createTankDirect("No Rename To Feed");
    const created = (await createSchedule({ tankId, actionType: "glass_clean", ...PLAN })) as { ok: boolean; data?: { id: number } };
    const id = created.data!.id;

    const res = (await updateSchedule(id, { tankId, actionType: "feed", ...PLAN })) as { ok: boolean };
    expect(res.ok).toBe(false);
    expect(getScheduleDirect(id)?.actionType).toBe("glass_clean");
  });

  it("the coach cannot propose one either (proposal schema)", async () => {
    const { proposalSchema } = await import("../src/lib/ai/proposal");
    const feed = proposalSchema.safeParse({
      rationale: "feed daily",
      changes: [{ kind: "create", tankId: 1, actionType: "feed", intervalDays: 1, preferredDays: 127 }],
    });
    expect(feed.success).toBe(false);
    const fert = proposalSchema.safeParse({
      rationale: "fertilize weekly",
      changes: [{ kind: "create", tankId: 1, actionType: "fertilize", intervalDays: 7, preferredDays: 127 }],
    });
    expect(fert.success).toBe(true);
  });
});

describe("retiring the feed plans that already exist", () => {
  it("migration 0006 deactivates active feed plans and leaves everything else alone", async () => {
    const { createTankDirect, createScheduleDirect, getScheduleDirect } = await import("./helpers");
    const { db } = await import("../src/lib/db");
    const tankId = await createTankDirect("Legacy Feed Plan");
    // straight into the table, exactly as the pre-fix app wrote it
    const feedPlan = await createScheduleDirect(tankId, { actionType: "feed", intervalDays: 1, preferredDays: 127 });
    const waterPlan = await createScheduleDirect(tankId, { actionType: "water_change", intervalDays: 7, preferredDays: 127 });
    expect(feedPlan.active).toBe(true);

    // the shipped migration statement itself, not a re-implementation of it
    const sql = readFileSync("drizzle/0006_feeding_is_not_a_plan.sql", "utf8");
    (db as unknown as { $client: { exec(s: string): void } }).$client.exec(sql);

    expect(getScheduleDirect(feedPlan.id)?.active).toBe(false);
    expect(getScheduleDirect(waterPlan.id)?.active).toBe(true);
  });

  it("a retired feed plan is gone from the care queue, the calendar and the ICS feed", async () => {
    const { listSchedules } = await import("../src/lib/repo");
    // listSchedules is active-only and is what the dashboard, the month
    // calendar and /api/calendar.ics all read through
    expect(listSchedules().some((s) => s.actionType === "feed")).toBe(false);
  });

  it("importing a pre-fix snapshot does not bring it back", async () => {
    const { buildExportSnapshot, importSnapshot } = await import("../src/lib/export");
    const { db } = await import("../src/lib/db");
    const { schedules } = await import("../src/lib/db/schema");
    const { eq } = await import("drizzle-orm");

    const snap = buildExportSnapshot() as unknown as { schedules: { id: number; actionType: string; active: boolean }[] };
    const feedRow = snap.schedules.find((s) => s.actionType === "feed")!;
    feedRow.active = true; // a backup taken before the fix

    importSnapshot(snap);

    const restored = db.select().from(schedules).where(eq(schedules.id, feedRow.id)).get();
    expect(restored?.actionType).toBe("feed"); // the row is kept for history
    expect(restored?.active).toBe(false); // but never back in the queue
  });
});

describe("what feeding DOES show: when it last happened", () => {
  it("reports the most recent feeding day per tank, backfill included", async () => {
    const { createTankDirect } = await import("./helpers");
    const { adjustFeedOn } = await import("../src/app/actions");
    const { lastFeedDays } = await import("../src/lib/repo");
    const { today, addDays } = await import("../src/lib/domain/dates");
    const { dayCount } = await import("../src/lib/domain/scheduler");

    const fluval = await createTankDirect("Fluval");
    const nano = await createTankDirect("Nanocube");
    const yesterday = addDays(today(), -1);

    // the reported scenario: both tanks fed YESTERDAY, entered TODAY
    await adjustFeedOn(fluval, yesterday, 1);
    await adjustFeedOn(nano, yesterday, 1);

    const last = lastFeedDays();
    expect(last.get(fluval)).toBe(yesterday);
    expect(last.get(nano)).toBe(yesterday);
    // what the dashboard line renders: "last fed yesterday" for BOTH — no
    // "2 days behind" on one and "due today" on the other
    expect(dayCount(last.get(fluval)!, today())).toBe(1);
    expect(dayCount(last.get(nano)!, today())).toBe(1);
  });

  it("counts from the newest feeding, not the first, and skips tanks never fed", async () => {
    const { createTankDirect } = await import("./helpers");
    const { adjustFeedOn } = await import("../src/app/actions");
    const { lastFeedDays } = await import("../src/lib/repo");
    const { today, addDays } = await import("../src/lib/domain/dates");

    const fed = await createTankDirect("Fed Twice");
    const never = await createTankDirect("Never Fed");
    await adjustFeedOn(fed, addDays(today(), -9), 1);
    await adjustFeedOn(fed, addDays(today(), -3), 1);

    const last = lastFeedDays();
    expect(last.get(fed)).toBe(addDays(today(), -3));
    expect(last.has(never)).toBe(false); // → "never fed", not "0 days ago"
  });
});
