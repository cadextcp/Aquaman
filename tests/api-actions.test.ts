/**
 * v1 REST API — POST /api/v1/actions (repo.ts:logActionCore), the display's
 * generic write path: writes a maintenance_logs row with source 'api', and
 * (unless applyToSchedule:false) marks the matching active plan done without
 * ever moving lastDoneAt backward. actionType "feed" is rejected — feeding
 * is a daily counter with its own endpoint (see api-feedings behavior
 * exercised indirectly through repo.ts's adjustFeedCore elsewhere).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { NextRequest } from "next/server";

const TMP = path.join(tmpdir(), `aquaman-api-actions-${Date.now()}`);
process.env.AQUAMAN_DATA_DIR = TMP;

let TOKEN = "";
let tankId = 0;

function postActions(body: unknown) {
  return new NextRequest("http://localhost/api/v1/actions", {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", "x-forwarded-for": "203.0.113.90" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  mkdirSync(TMP, { recursive: true });
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const { db } = await import("../src/lib/db");
  migrate(db, { migrationsFolder: "./drizzle" });
  const { getOrCreateApiToken } = await import("../src/lib/api-token");
  TOKEN = getOrCreateApiToken();
  const { tanks } = await import("../src/lib/db/schema");
  const tank = db.insert(tanks).values({ name: "Actions Tank", volumeL: 60, waterType: "fresh" }).returning().get();
  tankId = tank.id;
});

afterAll(async () => {
  const { closeDb } = await import("./helpers");
  closeDb();
  rmSync(TMP, { recursive: true, force: true });
});

describe("POST /api/v1/actions", () => {
  it("actionType 'feed' is rejected — feeding has its own daily-counter endpoint", async () => {
    const { POST } = await import("../src/app/api/v1/actions/route");
    const res = await POST(postActions({ tankId, actionType: "feed" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/feedings/i);
  });

  it("unknown tank → 404", async () => {
    const { POST } = await import("../src/app/api/v1/actions/route");
    const res = await POST(postActions({ tankId: 999999, actionType: "water_change" }));
    expect(res.status).toBe(404);
  });

  it("logs a maintenance row with source 'api' and marks the matching active plan done", async () => {
    const { db } = await import("../src/lib/db");
    const { schedules, maintenanceLogs } = await import("../src/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    const schedule = db
      .insert(schedules)
      .values({ tankId, actionType: "water_change", intervalDays: 7, preferredDays: 127 })
      .returning()
      .get();
    expect(schedule.lastDoneAt).toBeNull();

    const { POST } = await import("../src/app/api/v1/actions/route");
    const res = await POST(postActions({ tankId, actionType: "water_change", note: "via display" }));
    expect(res.status).toBe(201);

    const after = db.select().from(schedules).where(eq(schedules.id, schedule.id)).get()!;
    expect(after.lastDoneAt).toBeTruthy();
    expect(after.scheduleVersion).toBe(schedule.scheduleVersion + 1);

    const log = db
      .select()
      .from(maintenanceLogs)
      .where(eq(maintenanceLogs.tankId, tankId))
      .all()
      .find((l) => l.actionType === "water_change")!;
    expect(log.source).toBe("api");
    expect(log.note).toBe("via display");
  });

  it("applyToSchedule:false logs history but leaves the plan's lastDoneAt untouched", async () => {
    const { db } = await import("../src/lib/db");
    const { schedules } = await import("../src/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    const schedule = db
      .insert(schedules)
      .values({ tankId, actionType: "fertilize", intervalDays: 7, preferredDays: 127 })
      .returning()
      .get();

    const { POST } = await import("../src/app/api/v1/actions/route");
    const res = await POST(postActions({ tankId, actionType: "fertilize", applyToSchedule: false }));
    expect(res.status).toBe(201);

    const after = db.select().from(schedules).where(eq(schedules.id, schedule.id)).get()!;
    expect(after.lastDoneAt).toBeNull();
    expect(after.scheduleVersion).toBe(schedule.scheduleVersion);
  });

  it("a backdated doneAt never pulls lastDoneAt BACKWARD past a newer completion", async () => {
    const { db } = await import("../src/lib/db");
    const { schedules } = await import("../src/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    const schedule = db
      .insert(schedules)
      .values({ tankId, actionType: "filter_change", intervalDays: 30, preferredDays: 127 })
      .returning()
      .get();

    const { POST } = await import("../src/app/api/v1/actions/route");
    const recent = new Date().toISOString();
    await POST(postActions({ tankId, actionType: "filter_change", doneAt: recent }));

    const oneWeekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const backdated = await POST(postActions({ tankId, actionType: "filter_change", doneAt: oneWeekAgo, note: "forgot to log this" }));
    expect(backdated.status).toBe(201);

    const after = db.select().from(schedules).where(eq(schedules.id, schedule.id)).get()!;
    // still the RECENT completion — the backdated log must not make the task look overdue again
    expect(after.lastDoneAt).toBe(recent);
  });
});
