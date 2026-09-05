/**
 * Provenance on imported products (docs/plan-produkt-import-url.md §8,
 * migration 0008).
 *
 * The point of these columns is that a year from now somebody can tell whether
 * an analysis was transcribed off the tin or scraped from a shop that has
 * since changed the recipe. That only holds if three things are true: the date
 * comes from the server, an edit cannot rewrite the source, and a backup
 * round trip does not quietly drop it.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

const TMP = path.join(tmpdir(), `aquaman-product-source-${Date.now()}`);
process.env.AQUAMAN_DATA_DIR = TMP;

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const SOURCE = "https://www.zoomalia.de/tierhandlung/sera-flora-nature-p-46119.html";

let repo: typeof import("../src/lib/repo");

beforeAll(async () => {
  mkdirSync(TMP, { recursive: true });
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const { db } = await import("../src/lib/db");
  migrate(db, { migrationsFolder: "./drizzle" });
  repo = await import("../src/lib/repo");
});

afterAll(async () => {
  const { closeDb } = await import("./helpers");
  closeDb();
  rmSync(TMP, { recursive: true, force: true });
});

function get(id: number) {
  return repo.listProducts().find((p) => p.id === id)!;
}

describe("product provenance", () => {
  it("records the source and stamps the date server-side", () => {
    const before = Date.now();
    const res = repo.createProductCore({ kind: "food", name: "Imported Food", nutrients: {}, sourceUrl: SOURCE });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const row = get(res.id);
    expect(row.sourceUrl).toBe(SOURCE);
    expect(row.sourceFetchedAt).toBeTruthy();
    const stamped = Date.parse(row.sourceFetchedAt!);
    expect(Number.isNaN(stamped)).toBe(false);
    expect(stamped).toBeGreaterThanOrEqual(before - 1000);
    expect(stamped).toBeLessThanOrEqual(Date.now() + 1000);
  });

  // Absence is the information: no source line means a person typed it.
  it("leaves both columns null for a hand-typed product", () => {
    const res = repo.createProductCore({ kind: "food", name: "Typed Food", nutrients: {} });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const row = get(res.id);
    expect(row.sourceUrl).toBeNull();
    expect(row.sourceFetchedAt).toBeNull();
  });

  it("ignores a client-supplied fetch date", () => {
    const res = repo.createProductCore({
      kind: "food",
      name: "Lying Client",
      nutrients: {},
      sourceUrl: SOURCE,
      sourceFetchedAt: "1999-01-01T00:00:00.000Z",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(get(res.id).sourceFetchedAt!.startsWith("1999")).toBe(false);
  });

  it("refuses a source that is not an http(s) URL", () => {
    for (const bad of ["javascript:alert(1)", "file:///etc/passwd", "ftp://example.com/x", "not a url", "  "]) {
      const res = repo.createProductCore({ kind: "food", name: `Bad ${bad}`, nutrients: {}, sourceUrl: bad });
      expect(res.ok, bad).toBe(false);
      if (!res.ok) expect(res.code).toBe("validation");
    }
  });

  // Editing is the one path a person uses to CORRECT an imported entry. If it
  // could also rewrite the source, the line would stop meaning anything.
  it("keeps the source through an edit and cannot set one", () => {
    const created = repo.createProductCore({ kind: "food", name: "Edited Food", nutrients: {}, sourceUrl: SOURCE });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const stampedAt = get(created.id).sourceFetchedAt;

    const updated = repo.updateProductCore(created.id, {
      kind: "food",
      name: "Edited Food",
      description: "corrected by hand",
      nutrients: {},
      sourceUrl: "https://evil.example.com/other",
    });
    expect(updated.ok).toBe(true);

    const row = get(created.id);
    expect(row.description).toBe("corrected by hand");
    expect(row.sourceUrl).toBe(SOURCE);
    expect(row.sourceFetchedAt).toBe(stampedAt);
  });

  it("cannot attach a source to a hand-typed product by editing it", () => {
    const created = repo.createProductCore({ kind: "food", name: "Still Typed", nutrients: {} });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    repo.updateProductCore(created.id, { kind: "food", name: "Still Typed", nutrients: {}, sourceUrl: SOURCE });
    expect(get(created.id).sourceUrl).toBeNull();
  });

  it("serves both fields over the REST API", async () => {
    const { serializeProduct } = await import("../src/lib/api/serialize");
    const row = repo.listProducts().find((p) => p.name === "Imported Food")!;
    const json = serializeProduct(row);
    expect(json.sourceUrl).toBe(SOURCE);
    expect(json.sourceFetchedAt).toBeTruthy();
  });

  it("survives an export/import round trip", async () => {
    const { buildExportSnapshot, importSnapshot } = await import("../src/lib/export");
    const snapshot = buildExportSnapshot();
    const exported = (snapshot.products as { name: string; sourceUrl?: string | null }[]).find((p) => p.name === "Imported Food");
    expect(exported?.sourceUrl).toBe(SOURCE);

    // importSnapshot REPLACES the contents and returns per-table counts.
    const result = importSnapshot(JSON.parse(JSON.stringify(snapshot)));
    expect(result.products).toBeGreaterThan(0);
    const restored = repo.listProducts().find((p) => p.name === "Imported Food")!;
    expect(restored.sourceUrl).toBe(SOURCE);
    expect(restored.sourceFetchedAt).toBeTruthy();
  });

  // A backup taken before these columns existed must still restore.
  it("accepts a format-2 snapshot with no source fields at all", async () => {
    const { importSnapshot } = await import("../src/lib/export");
    const result = importSnapshot({
      format: 2,
      app: "aquaman",
      tanks: [],
      products: [
        { id: 1, kind: "food", name: "Old Backup Food", nutrients: {}, createdAt: "2026-08-01T10:00:00.000Z" },
      ],
      schedules: [],
      maintenanceLogs: [],
      waterTests: [],
      feedLogs: [],
      aiCalls: [],
    });
    expect(result.products).toBe(1);
    const restored = repo.listProducts().find((p) => p.name === "Old Backup Food")!;
    expect(restored.sourceUrl).toBeNull();
  });
});
