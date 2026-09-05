/**
 * Product archive ("used up", docs/plan-produkt-archiv.md). The contracts:
 * archived products leave listProducts (shelf, coach context, coverage) but
 * stay queryable; archiving REPORTS the plans that just lost something —
 * coverage-honest (a redundant second fertilizer changes nothing); the
 * archived name may be bought again; reactivating refuses a taken name.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

const TMP = path.join(tmpdir(), `aquaman-product-archive-${Date.now()}`);
process.env.AQUAMAN_DATA_DIR = TMP;

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

async function seed() {
  const { db } = await import("../src/lib/db");
  const { tanks, schedules } = await import("../src/lib/db/schema");
  const tank = db
    .insert(tanks)
    .values({
      name: "Archive Tank", volumeL: 60, waterType: "fresh",
      fish: [{ species: "Guppy", qty: 6 }],
      feedingPlan: 'Daily: "Alte Flocken" and nothing else.',
    })
    .returning()
    .get();
  const plan = db
    .insert(schedules)
    .values({
      tankId: tank.id, actionType: "fertilize", intervalDays: 7, preferredDays: 127,
      detailData: { nutrients: { fe: "5 ml" } },
    })
    .returning()
    .get();
  return { tankId: tank.id, planId: plan.id };
}

describe("archiveProductCore", () => {
  it("moves the product off the shelf and reports the plan that loses coverage", async () => {
    const { createProductCore, listProducts, listArchivedProducts, archiveProductCore } = await import("../src/lib/repo");
    const { tankId, planId } = await seed();
    const iron = createProductCore({ kind: "fertilizer", name: "Solo Eisen", nutrients: { fe: "0.2 %" } });
    expect(iron.ok).toBe(true);

    const res = archiveProductCore((iron as { id: number }).id);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.affected.schedules).toHaveLength(1);
      expect(res.affected.schedules[0]).toMatchObject({ id: planId, tankId, reason: "coverage" });
      expect(res.affected.feedingPlans).toHaveLength(0);
    }
    expect(listProducts().some((p) => p.name === "Solo Eisen")).toBe(false);
    expect(listArchivedProducts().some((p) => p.name === "Solo Eisen")).toBe(true);
  });

  it("is coverage-honest: a redundant second fertilizer changes nothing", async () => {
    const { createProductCore, archiveProductCore } = await import("../src/lib/repo");
    await seed();
    createProductCore({ kind: "fertilizer", name: "Eisen A", nutrients: { fe: "0.1 %" } });
    const b = createProductCore({ kind: "fertilizer", name: "Eisen B", nutrients: { fe: "0.3 %" } });
    expect(b.ok).toBe(true);

    const res = archiveProductCore((b as { id: number }).id); // A still supplies fe
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.affected.schedules).toHaveLength(0);
  });

  it("reports feeding plans that name the food (exact-names contract)", async () => {
    const { createProductCore, archiveProductCore } = await import("../src/lib/repo");
    const { tankId } = await seed();
    const food = createProductCore({ kind: "food", name: "Alte Flocken" });
    const res = archiveProductCore((food as { id: number }).id);
    expect(res.ok).toBe(true);
    if (res.ok) {
      // earlier seeds may have created more tanks with the same plan text —
      // this test's tank must be among them
      expect(res.affected.feedingPlans).toContainEqual({ tankId, tankName: "Archive Tank" });
    }
  });

  it("the archived name may be bought again (partial index ignores archived rows)", async () => {
    const { createProductCore, archiveProductCore } = await import("../src/lib/repo");
    const first = createProductCore({ kind: "food", name: "Wiederkauf Futter" });
    archiveProductCore((first as { id: number }).id);
    const second = createProductCore({ kind: "food", name: "Wiederkauf Futter" });
    expect(second.ok).toBe(true);
  });
});

describe("unarchiveProductCore", () => {
  it("puts a used-up product back, but not when the name is taken", async () => {
    const { createProductCore, archiveProductCore, unarchiveProductCore, listProducts } = await import("../src/lib/repo");
    const a = createProductCore({ kind: "food", name: "Zweite Flasche" });
    const id = (a as { id: number }).id;
    archiveProductCore(id);

    const back = unarchiveProductCore(id);
    expect(back.ok).toBe(true);
    expect(listProducts().some((p) => p.id === id)).toBe(true);

    archiveProductCore(id);
    createProductCore({ kind: "food", name: "Zweite Flasche" });
    const clash = unarchiveProductCore(id);
    expect(clash.ok).toBe(false);
    if (!clash.ok) expect(clash.code).toBe("product.duplicateName");
  });
});

describe("coach context after archiving", () => {
  it("excludes the product from INVENTORY and coverage, lists it as used up", async () => {
    const { createProductCore, archiveProductCore } = await import("../src/lib/repo");
    const { buildCoachContext } = await import("../src/lib/ai/context");
    const { db } = await import("../src/lib/db");
    const { products } = await import("../src/lib/db/schema");
    // self-contained: other tests' fertilizers would keep covering fe
    const saved = db.select().from(products).all();
    db.delete(products).run();
    try {
      await seed();
      const iron = createProductCore({ kind: "fertilizer", name: "Kontext Eisen", nutrients: { fe: "0.2 %" } });
      archiveProductCore((iron as { id: number }).id);

      const ctx = buildCoachContext();
      expect(ctx).not.toMatch(/#\d+ "Kontext Eisen"/);
      expect(ctx).toContain("used up (NOT on the shelf anymore");
      expect(ctx).toContain('"Kontext Eisen"');
      // the plan's iron has no supplier left — the coverage gap is now named
      expect(ctx).toContain("NOT covered by inventory: Fe");
    } finally {
      db.delete(products).run();
      for (const row of saved) db.insert(products).values([row]).run();
    }
  });
});

describe("export roundtrip keeps archivedAt", () => {
  it("an archived product survives export → wipe → import with its marker", async () => {
    const { createProductCore, archiveProductCore } = await import("../src/lib/repo");
    const { buildExportSnapshot, importSnapshot } = await import("../src/lib/export");
    const { db } = await import("../src/lib/db");
    const { products } = await import("../src/lib/db/schema");
    const a = createProductCore({ kind: "food", name: "Roundtrip Alt" });
    archiveProductCore((a as { id: number }).id);

    const snapshot = buildExportSnapshot();
    importSnapshot({
      format: 2, app: "aquaman",
      tanks: [], schedules: [], maintenanceLogs: [], waterTests: [], feedLogs: [], aiCalls: [],
    });
    importSnapshot(snapshot);
    const row = db.select().from(products).all().find((p) => p.name === "Roundtrip Alt");
    expect(row?.archivedAt).toBeTruthy();
  });
});
