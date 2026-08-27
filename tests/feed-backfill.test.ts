/**
 * Feeding day backfill (owner request): the dashboard's day navigation lets
 * you edit feeding on past days. Pins down: adjustFeedOn writes to the RIGHT
 * day only, keeps the 0..5 bounds, and the action-layer day validation
 * (future rejected, >30 days rejected, garbage rejected). adjustFeedToday
 * stays the same-action contract (r.data.timesFed) — now a thin wrapper over
 * the same repo core.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { vi } from "vitest";

const TMP = path.join(tmpdir(), `aquaman-feedbackfill-${Date.now()}`);
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

describe("adjustFeedOn (day backfill)", () => {
  it("writes to the chosen past day and never touches other days", async () => {
    const { createTankDirect } = await import("./helpers");
    const { adjustFeedOn } = await import("../src/app/actions");
    const { todayFeed } = await import("../src/lib/repo");
    const { today, addDays } = await import("../src/lib/domain/dates");
    const tankId = await createTankDirect("Backfill Tank");
    const yesterday = addDays(today(), -1);

    const r = await adjustFeedOn(tankId, yesterday, 1);
    expect(r.ok && r.data!.timesFed).toBe(1);
    expect(todayFeed(tankId, yesterday)?.timesFed).toBe(1);
    // today's row untouched — the nav edits exactly one day
    expect(todayFeed(tankId, today())).toBeUndefined();
  });

  it("keeps the 0..5 bounds per day (−1 below 0 is a no-op, +1 caps at 5)", async () => {
    const { createTankDirect } = await import("./helpers");
    const { adjustFeedOn } = await import("../src/app/actions");
    const { today, addDays } = await import("../src/lib/domain/dates");
    const tankId = await createTankDirect("Bounds Tank");
    const day = addDays(today(), -2);

    let r = await adjustFeedOn(tankId, day, -1); // nothing logged yet → no-op
    expect(r.ok && r.data!.timesFed).toBe(0);

    for (let i = 0; i < 8; i++) r = await adjustFeedOn(tankId, day, 1); // cap at 5
    expect(r.ok && r.data!.timesFed).toBe(5);
    r = await adjustFeedOn(tankId, day, -1);
    expect(r.ok && r.data!.timesFed).toBe(4);
  });

  it("future date rejected", async () => {
    const { createTankDirect } = await import("./helpers");
    const { adjustFeedOn } = await import("../src/app/actions");
    const { today, addDays } = await import("../src/lib/domain/dates");
    const tankId = await createTankDirect("Future Tank");
    const r = await adjustFeedOn(tankId, addDays(today(), 1), 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/future/i);
  });

  it("older than the 30-day window rejected, exactly 30 days allowed", async () => {
    const { createTankDirect } = await import("./helpers");
    const { adjustFeedOn } = await import("../src/app/actions");
    const { today, addDays } = await import("../src/lib/domain/dates");
    const tankId = await createTankDirect("Window Tank");

    const tooOld = await adjustFeedOn(tankId, addDays(today(), -31), 1);
    expect(tooOld.ok).toBe(false);
    if (!tooOld.ok) expect(tooOld.error).toMatch(/30 days/);

    const edge = await adjustFeedOn(tankId, addDays(today(), -30), 1);
    expect(edge.ok).toBe(true);
  });

  it("garbage date rejected", async () => {
    const { createTankDirect } = await import("./helpers");
    const { adjustFeedOn } = await import("../src/app/actions");
    const tankId = await createTankDirect("Garbage Tank");
    const r = await adjustFeedOn(tankId, "2026-13-99", 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/invalid date/i);
  });
});

describe("adjustFeedToday (today wrapper over the same core)", () => {
  it("keeps the ActionResult data contract and today-keyed writes", async () => {
    const { createTankDirect } = await import("./helpers");
    const { adjustFeedToday } = await import("../src/app/actions");
    const { todayFeed } = await import("../src/lib/repo");
    const { today } = await import("../src/lib/domain/dates");
    const tankId = await createTankDirect("Today Tank");

    const r = await adjustFeedToday(tankId, 1);
    expect(r.ok && r.data!.timesFed).toBe(1);
    expect(todayFeed(tankId, today())?.timesFed).toBe(1);
  });
});
