/**
 * Integration test for the /api/calendar.ics route handler itself — token
 * gating, rate limiting, and content headers (TechDesign v1.2 §4.4/§8b).
 * Runs against a throwaway SQLite file with one seeded tank+schedule.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { NextRequest } from "next/server";

const TMP = path.join(tmpdir(), `aquaman-ics-route-${Date.now()}`);
process.env.AQUAMAN_DATA_DIR = TMP;

function reqWithToken(token: string | null, ip = "203.0.113.7"): NextRequest {
  const url = token
    ? `http://localhost/api/calendar.ics?t=${encodeURIComponent(token)}`
    : "http://localhost/api/calendar.ics";
  return new NextRequest(url, { headers: { "x-forwarded-for": ip } });
}

beforeAll(async () => {
  mkdirSync(TMP, { recursive: true });
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const { db } = await import("../src/lib/db");
  migrate(db, { migrationsFolder: "./drizzle" });
  const { tanks, schedules } = await import("../src/lib/db/schema");
  const tank = db
    .insert(tanks)
    .values({ name: "Route Test Tank", volumeL: 100, waterType: "fresh" })
    .returning()
    .get();
  db.insert(schedules)
    .values({ tankId: tank.id, actionType: "water_change", intervalDays: 7, preferredDays: 127 })
    .run();
});

afterAll(async () => {
  const { closeDb } = await import("./helpers");
  closeDb();
  rmSync(TMP, { recursive: true, force: true });
});

beforeEach(async () => {
  const { __resetRateLimiter } = await import("../src/lib/rate-limit");
  __resetRateLimiter();
});

describe("GET /api/calendar.ics", () => {
  it("missing token → 404", async () => {
    const { GET } = await import("../src/app/api/calendar.ics/route");
    const res = await GET(reqWithToken(null, "198.51.100.1"));
    expect(res.status).toBe(404);
  });

  it("wrong token → 404 (not 401 — never confirm existence)", async () => {
    const { GET } = await import("../src/app/api/calendar.ics/route");
    const res = await GET(reqWithToken("definitely-wrong", "198.51.100.2"));
    expect(res.status).toBe(404);
  });

  it("correct token → 200 with calendar content-type and a VEVENT for the seeded schedule", async () => {
    const { GET } = await import("../src/app/api/calendar.ics/route");
    const { getOrCreateIcsToken } = await import("../src/lib/ics-token");
    const token = getOrCreateIcsToken();
    const res = await GET(reqWithToken(token, "198.51.100.3"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/calendar");
    expect(res.headers.get("cache-control")).toContain("max-age=3600");
    const body = await res.text();
    expect(body).toContain("BEGIN:VEVENT");
    expect(body).toContain("Water change");
  });

  it("30 failed attempts from the same IP → 429, even with a valid token", async () => {
    const { GET } = await import("../src/app/api/calendar.ics/route");
    const { getOrCreateIcsToken } = await import("../src/lib/ics-token");
    const ip = "198.51.100.4";
    for (let i = 0; i < 30; i++) {
      const res = await GET(reqWithToken("wrong", ip));
      expect(res.status).toBe(404);
    }
    const token = getOrCreateIcsToken();
    const blocked = await GET(reqWithToken(token, ip));
    expect(blocked.status).toBe(429);
  });

  it("a successful request resets the failure counter for that IP", async () => {
    const { GET } = await import("../src/app/api/calendar.ics/route");
    const { getOrCreateIcsToken } = await import("../src/lib/ics-token");
    const ip = "198.51.100.5";
    const token = getOrCreateIcsToken();
    for (let i = 0; i < 10; i++) await GET(reqWithToken("wrong", ip));
    const ok = await GET(reqWithToken(token, ip));
    expect(ok.status).toBe(200);
    // failures should be cleared — another 25 wrong attempts should NOT hit 429 yet
    for (let i = 0; i < 25; i++) {
      const res = await GET(reqWithToken("wrong", ip));
      expect(res.status).toBe(404);
    }
  });
});
