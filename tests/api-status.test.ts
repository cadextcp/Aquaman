/**
 * v1 REST API — GET /api/v1/tanks/{id}/status, the one-request payload an
 * ESPHome display polls. Checks the "last done" projection per actionType
 * and the data boundary (no server paths).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { NextRequest } from "next/server";

const TMP = path.join(tmpdir(), `aquaman-api-status-${Date.now()}`);
process.env.AQUAMAN_DATA_DIR = TMP;

let TOKEN = "";
let tankId = 0;

function getReq(url: string) {
  return new NextRequest(url, { headers: { authorization: `Bearer ${TOKEN}`, "x-forwarded-for": "203.0.113.91" } });
}

beforeAll(async () => {
  mkdirSync(TMP, { recursive: true });
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const { db } = await import("../src/lib/db");
  migrate(db, { migrationsFolder: "./drizzle" });
  const { getOrCreateApiToken } = await import("../src/lib/api-token");
  TOKEN = getOrCreateApiToken();

  const { tanks, schedules, maintenanceLogs, feedLogs } = await import("../src/lib/db/schema");
  const tank = db
    .insert(tanks)
    .values({ name: "Status Tank", volumeL: 120, waterType: "fresh", photoPath: "/app/data/uploads/secret.jpg" })
    .returning()
    .get();
  tankId = tank.id;

  db.insert(schedules).values({ tankId, actionType: "water_change", intervalDays: 7, preferredDays: 127 }).run();

  const sixDaysAgo = new Date(Date.now() - 6 * 86400000).toISOString();
  db.insert(maintenanceLogs).values({ tankId, actionType: "water_change", doneAt: sixDaysAgo, source: "user" }).run();
  // fertilize has NO active schedule — status must still surface it from the log
  db.insert(maintenanceLogs).values({ tankId, actionType: "fertilize", doneAt: sixDaysAgo, source: "user" }).run();

  const today = new Date().toISOString().slice(0, 10);
  db.insert(feedLogs).values({ tankId, day: today, fedAt: new Date().toISOString(), timesFed: 1 }).run();
});

afterAll(async () => {
  const { closeDb } = await import("./helpers");
  closeDb();
  rmSync(TMP, { recursive: true, force: true });
});

describe("GET /api/v1/tanks/{id}/status", () => {
  it("unknown tank → 404", async () => {
    const { GET } = await import("../src/app/api/v1/tanks/[id]/status/route");
    const res = await GET(getReq("http://localhost/api/v1/tanks/999999/status"), { params: Promise.resolve({ id: "999999" }) });
    expect(res.status).toBe(404);
  });

  it("returns lastDoneDay/daysAgo per actionType, feed as a daily count, and NEVER a server path", async () => {
    const { GET } = await import("../src/app/api/v1/tanks/[id]/status/route");
    const res = await GET(getReq(`http://localhost/api/v1/tanks/${tankId}/status`), { params: Promise.resolve({ id: String(tankId) }) });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.tank.name).toBe("Status Tank");
    expect(JSON.stringify(body)).not.toContain("photoPath");
    expect(JSON.stringify(body)).not.toContain("secret.jpg");

    // water_change: has both a log AND an active plan
    expect(body.actions.water_change.daysAgo).toBe(6);
    expect(body.actions.water_change.scheduleId).toBeTruthy();
    expect(typeof body.actions.water_change.plannedFor).toBe("string");

    // fertilize: log only, no active plan — still surfaced, no scheduleId
    expect(body.actions.fertilize.daysAgo).toBe(6);
    expect(body.actions.fertilize.scheduleId).toBeUndefined();

    // feed: sourced from feed_logs, not maintenance_logs
    expect(body.actions.feed.daysAgo).toBe(0);
    expect(body.actions.feed.todayCount).toBe(1);
  });
});
