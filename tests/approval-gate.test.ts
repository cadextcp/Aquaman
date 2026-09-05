/**
 * Approval-gate tests (Phase 4): applyProposal is the ONLY write path for AI
 * proposals. Pins down: DB unchanged until confirm, re-validation against
 * live data, scheduleVersion bump on adjust, partial application.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { vi } from "vitest";
import { eq } from "drizzle-orm";

const TMP = path.join(tmpdir(), `aquaman-approval-${Date.now()}`);
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

describe("applyProposal (approval gate)", () => {
  it("invalid proposal input → ok:false, nothing written", async () => {
    const { applyProposal } = await import("../src/app/actions-ai");
    const res = await applyProposal({ garbage: true });
    expect(res.ok).toBe(false);
  });

  it("create: writes a schedule after approval; tank must exist live", async () => {
    const { applyProposal } = await import("../src/app/actions-ai");
    const { createTankDirect, listSchedules } = await import("./helpers");
    const tankId = await createTankDirect("Approval Tank");

    const before = listSchedules(tankId).length;
    const res = await applyProposal({
      rationale: "new tank needs a plan",
      changes: [{ kind: "create", tankId, actionType: "water_change", intervalDays: 7, preferredDays: 96 }],
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data!.applied).toHaveLength(1);
      expect(res.data!.skipped).toHaveLength(0);
    }
    expect(listSchedules(tankId).length).toBe(before + 1);
  });

  it("create on a soft-deleted tank → skipped, nothing written", async () => {
    const { applyProposal } = await import("../src/app/actions-ai");
    const { db } = await import("../src/lib/db");
    const { tanks } = await import("../src/lib/db/schema");
    const dead = db
      .insert(tanks)
      .values({ name: "Dead Tank", volumeL: 50, waterType: "fresh" })
      .returning()
      .get();
    db.update(tanks).set({ deletedAt: new Date().toISOString() }).where(eq(tanks.id, dead.id)).run();

    const res = await applyProposal({
      rationale: "stale tank id",
      changes: [{ kind: "create", tankId: dead.id, actionType: "fertilize", intervalDays: 3, preferredDays: 127 }],
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data!.applied).toHaveLength(0);
      expect(res.data!.skipped).toHaveLength(1);
      expect(res.data!.skipped[0].reason).toContain("no longer exists");
    }
  });

  it("adjust: interval change bumps scheduleVersion and clears snooze", async () => {
    const { applyProposal } = await import("../src/app/actions-ai");
    const { createTankDirect, createScheduleDirect, getScheduleDirect } = await import("./helpers");
    const tankId = await createTankDirect("Adj Tank");
    const s = await createScheduleDirect(tankId, { actionType: "water_change", intervalDays: 14, preferredDays: 127 });

    const res = await applyProposal({
      rationale: "nitrate rising — shorten interval",
      changes: [{ kind: "adjust", scheduleId: s.id, intervalDays: 7 }],
    });
    expect(res.ok).toBe(true);
    const after = getScheduleDirect(s.id)!;
    expect(after.intervalDays).toBe(7);
    expect(after.scheduleVersion).toBe(s.scheduleVersion + 1);
    expect(after.snoozedUntil).toBeNull();
  });

  it("adjust on nonexistent schedule → skipped", async () => {
    const { applyProposal } = await import("../src/app/actions-ai");
    const res = await applyProposal({
      rationale: "stale",
      changes: [{ kind: "adjust", scheduleId: 999999, intervalDays: 7 }],
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data!.applied).toHaveLength(0);
      expect(res.data!.skipped).toHaveLength(1);
    }
  });

  it("partial application: one stale + one valid change", async () => {
    const { applyProposal } = await import("../src/app/actions-ai");
    const { createTankDirect, createScheduleDirect } = await import("./helpers");
    const tankId = await createTankDirect("Partial Tank");
    const s = await createScheduleDirect(tankId, { actionType: "fertilize", intervalDays: 7, preferredDays: 127 });

    const res = await applyProposal({
      rationale: "mixed",
      changes: [
        { kind: "adjust", scheduleId: 999999, intervalDays: 5 },
        { kind: "adjust", scheduleId: s.id, intervalDays: 5 },
      ],
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data!.applied).toHaveLength(1);
      expect(res.data!.skipped).toHaveLength(1);
    }
  });

  it("set_feeding_plan: writes tanks.feedingPlan after approval, and only then", async () => {
    const { applyProposal } = await import("../src/app/actions-ai");
    const { createTankDirect } = await import("./helpers");
    const { db } = await import("../src/lib/db");
    const { tanks } = await import("../src/lib/db/schema");
    const tankId = await createTankDirect("Feeding Tank");
    const PLAN = "**Mo/Do/So:** Flocken, kleine Portion\n**Sa:** Fastentag";
    const proposal = {
      rationale: "grounded in the foods the shelf lists",
      changes: [{ kind: "set_feeding_plan" as const, tankId, feedingPlan: PLAN }],
    };

    // the approval gate IS the write path — nothing lands before applyProposal
    expect(db.select().from(tanks).where(eq(tanks.id, tankId)).get()!.feedingPlan).toBeNull();

    const res = await applyProposal(proposal);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data!.applied).toHaveLength(1);
      expect(res.data!.skipped).toHaveLength(0);
    }
    expect(db.select().from(tanks).where(eq(tanks.id, tankId)).get()!.feedingPlan).toBe(PLAN);
  });

  it("set_feeding_plan on a soft-deleted tank → skipped, plan untouched", async () => {
    const { applyProposal } = await import("../src/app/actions-ai");
    const { db } = await import("../src/lib/db");
    const { tanks } = await import("../src/lib/db/schema");
    const dead = db
      .insert(tanks)
      .values({ name: "Dead Feeding Tank", volumeL: 50, waterType: "fresh" })
      .returning()
      .get();
    db.update(tanks).set({ deletedAt: new Date().toISOString() }).where(eq(tanks.id, dead.id)).run();

    const res = await applyProposal({
      rationale: "stale tank id",
      changes: [{ kind: "set_feeding_plan", tankId: dead.id, feedingPlan: "**Mo:** Flocken" }],
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data!.applied).toHaveLength(0);
      expect(res.data!.skipped).toHaveLength(1);
      expect(res.data!.skipped[0].reason).toContain("no longer exists");
    }
    expect(db.select().from(tanks).where(eq(tanks.id, dead.id)).get()!.feedingPlan).toBeNull();
  });
});
