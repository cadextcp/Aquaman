/**
 * /api/v1/products — the inventory over REST (docs/plan-produkt-lager.md §8.2).
 *
 * The routes are thin wrappers over the repo cores, so what is worth testing
 * here is the transport: the bearer gate (404, never 401), the status codes a
 * client branches on, and that a rename over the API reports the plans it
 * touched just like the app does.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { NextRequest } from "next/server";

const TMP = path.join(tmpdir(), `aquaman-api-products-${Date.now()}`);
process.env.AQUAMAN_DATA_DIR = TMP;

let TOKEN = "";

function req(url: string, opts: { token?: string | null; method?: string; body?: unknown } = {}): NextRequest {
  const headers: Record<string, string> = { "x-forwarded-for": "203.0.113.90" };
  if (opts.token !== null) headers["authorization"] = `Bearer ${opts.token ?? TOKEN}`;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(url, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

const params = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });

beforeAll(async () => {
  mkdirSync(TMP, { recursive: true });
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const { db } = await import("../src/lib/db");
  migrate(db, { migrationsFolder: "./drizzle" });
  const { getOrCreateApiToken } = await import("../src/lib/api-token");
  TOKEN = getOrCreateApiToken();
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

describe("/api/v1/products", () => {
  let fertilizerId = 0;

  it("a wrong token gets 404, never 401 — the endpoint never confirms it exists", async () => {
    const { GET } = await import("../src/app/api/v1/products/route");
    const res = await GET(req("http://localhost/api/v1/products", { token: "wrong-but-plausible" }));
    expect(res.status).toBe(404);
  });

  it("creates a fertilizer and returns 201 with its id", async () => {
    const { POST } = await import("../src/app/api/v1/products/route");
    const res = await POST(
      req("http://localhost/api/v1/products", {
        method: "POST",
        body: { kind: "fertilizer", name: "API Ferro", nutrients: { fe: "0.2 %" }, defaultDose: "10 ml" },
      }),
    );
    expect(res.status).toBe(201);
    fertilizerId = (await res.json()).id;
    expect(fertilizerId).toBeGreaterThan(0);
  });

  it("lists products and filters by kind", async () => {
    const { GET, POST } = await import("../src/app/api/v1/products/route");
    await POST(req("http://localhost/api/v1/products", { method: "POST", body: { kind: "food", name: "API Flakes" } }));

    const all = await (await GET(req("http://localhost/api/v1/products"))).json();
    expect(all.products.map((p: { name: string }) => p.name).sort()).toEqual(["API Ferro", "API Flakes"]);

    const foods = await (await GET(req("http://localhost/api/v1/products?kind=food"))).json();
    expect(foods.products).toHaveLength(1);
    expect(foods.products[0].name).toBe("API Flakes");
  });

  it("rejects an unknown ?kind with 400 rather than quietly returning everything", async () => {
    const { GET } = await import("../src/app/api/v1/products/route");
    const res = await GET(req("http://localhost/api/v1/products?kind=shampoo"));
    expect(res.status).toBe(400);
  });

  it("a duplicate live name is 409, and carries the code a client can branch on", async () => {
    const { POST } = await import("../src/app/api/v1/products/route");
    const res = await POST(req("http://localhost/api/v1/products", { method: "POST", body: { kind: "fertilizer", name: "API Ferro" } }));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("product.duplicateName");
  });

  it("invalid input is 400 (nutrients on a food)", async () => {
    const { POST } = await import("../src/app/api/v1/products/route");
    const res = await POST(
      req("http://localhost/api/v1/products", { method: "POST", body: { kind: "food", name: "Wrong", nutrients: { fe: "1 %" } } }),
    );
    expect(res.status).toBe(400);
  });

  it("GET one product returns it without server-local fields", async () => {
    const { GET } = await import("../src/app/api/v1/products/[id]/route");
    const res = await GET(req(`http://localhost/api/v1/products/${fertilizerId}`), params(fertilizerId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ id: fertilizerId, kind: "fertilizer", name: "API Ferro", defaultDose: "10 ml" });
    expect(body.nutrients).toEqual({ fe: "0.2 %" });
    expect(body).not.toHaveProperty("deletedAt");
  });

  it("a missing or non-numeric id is 404, not a crash", async () => {
    const { GET } = await import("../src/app/api/v1/products/[id]/route");
    expect((await GET(req("http://localhost/api/v1/products/999999"), params(999999))).status).toBe(404);
    expect((await GET(req("http://localhost/api/v1/products/abc"), params("abc"))).status).toBe(404);
  });

  it("PATCH renames and reports how many active plans were re-keyed", async () => {
    const { PATCH } = await import("../src/app/api/v1/products/[id]/route");
    const { POST } = await import("../src/app/api/v1/products/route");
    const { db } = await import("../src/lib/db");
    const { tanks, schedules } = await import("../src/lib/db/schema");

    const made = await (
      await POST(req("http://localhost/api/v1/products", { method: "POST", body: { kind: "food", name: "Rename me" } }))
    ).json();
    const tank = db.insert(tanks).values({ name: "API T", volumeL: 60, waterType: "fresh" }).returning().get();
    db.insert(schedules)
      .values({
        tankId: tank.id, actionType: "water_change", intervalDays: 7, preferredDays: 127, active: true,
        detailData: { foods: { "Rename me": "1 pinch" } },
      })
      .run();

    const res = await PATCH(
      req(`http://localhost/api/v1/products/${made.id}`, { method: "PATCH", body: { kind: "food", name: "Renamed" } }),
      params(made.id),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: made.id, renamedPlans: 1 });
  });

  it("DELETE soft-deletes: 204, gone from the list, second delete is 404", async () => {
    const { DELETE } = await import("../src/app/api/v1/products/[id]/route");
    const { GET } = await import("../src/app/api/v1/products/route");

    expect((await DELETE(req(`http://localhost/api/v1/products/${fertilizerId}`, { method: "DELETE" }), params(fertilizerId))).status).toBe(204);

    const list = await (await GET(req("http://localhost/api/v1/products"))).json();
    expect(list.products.map((p: { name: string }) => p.name)).not.toContain("API Ferro");

    expect((await DELETE(req(`http://localhost/api/v1/products/${fertilizerId}`, { method: "DELETE" }), params(fertilizerId))).status).toBe(404);
  });
});
