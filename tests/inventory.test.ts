/**
 * Product inventory (docs/plan-produkt-lager.md, migration 0007).
 *
 * The cases that matter are the ones where a mistake is silent: the migration
 * losing a food, a rename orphaning a plan's dose, a v1 backup restoring with
 * an empty shelf. Everything here goes through a real temp SQLite file so the
 * partial unique index and the CHECK are actually exercised.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdirSync, rmSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

const TMP = path.join(tmpdir(), `aquaman-inventory-${Date.now()}`);
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

describe("migration 0007 lifts tanks.foods into the inventory", () => {
  /**
   * Applies every migration except 0007, seeds the pre-0007 world, then
   * applies 0007 — the same order a real upgrade takes. Run against its own
   * database file so it cannot disturb the tests below.
   */
  function migrateWithFoods(seed: (db: Database.Database) => void) {
    const file = path.join(TMP, `mig-${Math.random().toString(36).slice(2)}.db`);
    const db = new Database(file);
    const files = readdirSync("./drizzle").filter((f) => f.endsWith(".sql")).sort();
    const apply = (f: string) => {
      for (const stmt of readFileSync(path.join("./drizzle", f), "utf8").split("--> statement-breakpoint")) {
        if (stmt.trim()) db.exec(stmt);
      }
    };
    // Strictly in file order, pausing at 0007 to seed. Applying "everything
    // except 0007" and then 0007 worked only while 0007 was the last one:
    // 0008 ALTERs `products`, which 0007 is what creates.
    const at = files.findIndex((f) => f.startsWith("0007"));
    for (const f of files.slice(0, at)) apply(f);
    seed(db);
    for (const f of files.slice(at)) apply(f);
    return db;
  }

  it("dedupes by name across tanks, keeps a dose, and drops the column", () => {
    const db = migrateWithFoods((d) => {
      const ins = d.prepare("INSERT INTO tanks (name, volume_l, water_type, foods) VALUES (?,?,?,?)");
      ins.run("A", 60, "fresh", JSON.stringify([{ name: "Flakes", amount: "1", unit: "pinch" }]));
      ins.run("B", 200, "fresh", JSON.stringify([{ name: "Flakes", amount: "2", unit: "pinches" }, { name: "Granules", amount: "", unit: "" }]));
    });
    const rows = db.prepare("SELECT kind, name, default_dose FROM products ORDER BY name").all() as { kind: string; name: string; default_dose: string | null }[];
    expect(rows.map((r) => r.name)).toEqual(["Flakes", "Granules"]);
    expect(rows.every((r) => r.kind === "food")).toBe(true);
    expect(rows[0].default_dose).toMatch(/pinch/);
    // no amount + no unit must not become a blank string dose
    expect(rows[1].default_dose).toBeNull();
    expect((db.prepare("PRAGMA table_info(tanks)").all() as { name: string }[]).some((c) => c.name === "foods")).toBe(false);
    db.close();
  });

  it("skips blank names and soft-deleted tanks", () => {
    const db = migrateWithFoods((d) => {
      d.prepare("INSERT INTO tanks (name, volume_l, water_type, foods) VALUES (?,?,?,?)")
        .run("Live", 60, "fresh", JSON.stringify([{ name: "   ", amount: "1", unit: "x" }, { name: "Real", amount: "1", unit: "x" }]));
      d.prepare("INSERT INTO tanks (name, volume_l, water_type, foods, deleted_at) VALUES (?,?,?,?,?)")
        .run("Gone", 30, "fresh", JSON.stringify([{ name: "Ghost", amount: "1", unit: "x" }]), "2026-01-01T00:00:00Z");
    });
    expect((db.prepare("SELECT name FROM products").all() as { name: string }[]).map((r) => r.name)).toEqual(["Real"]);
    db.close();
  });

  it("leaves a plan's detailData untouched — feed doses are keyed by the food NAME", () => {
    const db = migrateWithFoods((d) => {
      d.prepare("INSERT INTO tanks (name, volume_l, water_type, foods) VALUES (?,?,?,?)")
        .run("A", 60, "fresh", JSON.stringify([{ name: "Flakes", amount: "1", unit: "pinch" }]));
      d.prepare("INSERT INTO schedules (tank_id, action_type, interval_days, detail_data, active) VALUES (1,'water_change',7,?,0)")
        .run(JSON.stringify({ foods: { Flakes: "1 pinch" } }));
    });
    const row = db.prepare("SELECT detail_data FROM schedules").get() as { detail_data: string };
    expect(JSON.parse(row.detail_data)).toEqual({ foods: { Flakes: "1 pinch" } });
    db.close();
  });
});

describe("product cores", () => {
  it("creates, lists fertilizers before foods, and rejects a duplicate live name", async () => {
    const { createProductCore, listProducts } = await import("../src/lib/repo");

    const fert = createProductCore({ kind: "fertilizer", name: "Makro NPK", nutrients: { n_no3: "0.2 %", k: "" } });
    expect(fert.ok).toBe(true);
    expect(createProductCore({ kind: "food", name: "NovoBel", defaultDose: "1 pinch" }).ok).toBe(true);

    const all = listProducts();
    expect(all.map((p) => p.kind)).toEqual(["fertilizer", "food"]);
    expect(listProducts("food").map((p) => p.name)).toEqual(["NovoBel"]);

    const dup = createProductCore({ kind: "food", name: "NovoBel" });
    expect(dup.ok).toBe(false);
    expect((dup as { code: string }).code).toBe("product.duplicateName");

    // same name, other kind: a fertilizer called NovoBel is a different thing
    expect(createProductCore({ kind: "fertilizer", name: "NovoBel" }).ok).toBe(true);
  });

  it("refuses nutrients on a food and unknown nutrient keys", async () => {
    const { createProductCore } = await import("../src/lib/repo");
    expect(createProductCore({ kind: "food", name: "Wrong", nutrients: { fe: "1 %" } }).ok).toBe(false);
    expect(createProductCore({ kind: "fertilizer", name: "Bogus", nutrients: { unobtainium: "1 %" } }).ok).toBe(false);
  });

  it("soft-deletes: gone from the list, and the name becomes reusable", async () => {
    const { createProductCore, deleteProductCore, listProducts } = await import("../src/lib/repo");
    const made = createProductCore({ kind: "food", name: "Temporary" }) as { ok: true; id: number };
    expect(deleteProductCore(made.id).ok).toBe(true);
    expect(listProducts("food").map((p) => p.name)).not.toContain("Temporary");
    expect(createProductCore({ kind: "food", name: "Temporary" }).ok).toBe(true);
    // deleting the same row twice is a not-found, not a silent success
    expect(deleteProductCore(made.id).ok).toBe(false);
  });

  it("renaming carries the food key into ACTIVE plans but never into history", async () => {
    const { createProductCore, updateProductCore } = await import("../src/lib/repo");
    const { db } = await import("../src/lib/db");
    const { tanks, schedules, maintenanceLogs } = await import("../src/lib/db/schema");

    const tank = db.insert(tanks).values({ name: "RenameT", volumeL: 60, waterType: "fresh" }).returning().get();
    const made = createProductCore({ kind: "food", name: "Old Flakes", defaultDose: "1 pinch" }) as { ok: true; id: number };

    const active = db
      .insert(schedules)
      .values({ tankId: tank.id, actionType: "water_change", intervalDays: 7, preferredDays: 127, active: true, detailData: { foods: { "Old Flakes": "1 pinch", Other: "2 cubes" } } })
      .returning()
      .get();
    const inactive = db
      .insert(schedules)
      .values({ tankId: tank.id, actionType: "fertilize", intervalDays: 7, preferredDays: 127, active: false, detailData: { foods: { "Old Flakes": "1 pinch" } } })
      .returning()
      .get();
    const log = db
      .insert(maintenanceLogs)
      .values({ tankId: tank.id, actionType: "water_change", doneAt: "2026-08-01T10:00:00Z", detailData: { foods: { "Old Flakes": "1 pinch" } } })
      .returning()
      .get();

    const res = updateProductCore(made.id, { kind: "food", name: "New Flakes", defaultDose: "1 pinch" });
    expect(res.ok).toBe(true);
    expect((res as { ok: true; renamedPlans: number }).renamedPlans).toBe(1);

    const activeAfter = db.select().from(schedules).all().find((s) => s.id === active.id);
    expect(Object.keys((activeAfter!.detailData as { foods: Record<string, string> }).foods)).toEqual(["New Flakes", "Other"]);

    const inactiveAfter = db.select().from(schedules).all().find((s) => s.id === inactive.id);
    expect((inactiveAfter!.detailData as { foods: Record<string, string> }).foods).toHaveProperty("Old Flakes");

    const logAfter = db.select().from(maintenanceLogs).all().find((l) => l.id === log.id);
    expect((logAfter!.detailData as { foods: Record<string, string> }).foods).toHaveProperty("Old Flakes");
  });
});

describe("export/import", () => {
  it("round-trips products at format 2", async () => {
    const { buildExportSnapshot, importSnapshot, EXPORT_FORMAT_VERSION } = await import("../src/lib/export");
    const { listProducts } = await import("../src/lib/repo");

    const snap = buildExportSnapshot();
    expect(EXPORT_FORMAT_VERSION).toBe(2);
    const before = listProducts().map((p) => p.name).sort();
    expect(snap.products.length).toBeGreaterThan(0);

    importSnapshot(snap);
    expect(listProducts().map((p) => p.name).sort()).toEqual(before);
  });

  it("lifts a format-1 backup's tank foods into the inventory instead of dropping them", async () => {
    const { importSnapshot } = await import("../src/lib/export");
    const { listProducts } = await import("../src/lib/repo");

    const tank = (name: string, id: number, foods: { name: string; amount: string; unit: string }[], deletedAt: string | null = null) => ({
      id, name, volumeL: 60, waterType: "fresh" as const, photoPath: null, plants: [], fish: [], foods,
      hasCo2: false, hasHeater: false, hasFilter: true, filterType: null, tankState: "established" as const,
      paramOverrides: {}, createdAt: "2026-08-01T00:00:00Z", deletedAt,
    });

    const res = importSnapshot({
      format: 1,
      app: "aquaman",
      tanks: [
        tank("A", 501, [{ name: "Legacy Flakes", amount: "1", unit: "pinch" }, { name: "Shared", amount: "2", unit: "cubes" }]),
        tank("B", 502, [{ name: "Shared", amount: "9", unit: "cubes" }]),
        tank("Gone", 503, [{ name: "Ghost", amount: "1", unit: "x" }], "2026-01-01T00:00:00Z"),
      ],
      schedules: [],
      maintenanceLogs: [],
      waterTests: [],
      feedLogs: [],
      aiCalls: [],
    });

    const names = listProducts("food").map((p) => p.name);
    expect(names).toContain("Legacy Flakes");
    expect(names.filter((n) => n === "Shared")).toHaveLength(1); // deduped across tanks
    expect(names).not.toContain("Ghost"); // soft-deleted tank, same rule as the migration
    expect(res.products).toBe(2);
  });

  it("a format-2 snapshot replaces the shelf rather than merging into it", async () => {
    const { importSnapshot } = await import("../src/lib/export");
    const { listProducts } = await import("../src/lib/repo");

    importSnapshot({
      format: 2,
      app: "aquaman",
      tanks: [],
      products: [
        { id: 900, kind: "fertilizer", name: "Only One", nutrients: { fe: "0.2 %" }, description: null, defaultDose: null, createdAt: "2026-08-01T00:00:00Z", deletedAt: null },
      ],
      schedules: [],
      maintenanceLogs: [],
      waterTests: [],
      feedLogs: [],
      aiCalls: [],
    });
    expect(listProducts().map((p) => p.name)).toEqual(["Only One"]);
  });
});
