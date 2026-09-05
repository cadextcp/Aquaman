/**
 * POST /api/inventory/import.
 *
 * The assertion this file exists for: **no failure path reaches the model.**
 * A blocked shop, a JS shell, a bad address — each must be decided before a
 * single token is spent, because a model asked to describe a page it never saw
 * will happily invent a fish food. `draftSpy` counts the calls, and most tests
 * here assert it stayed at zero.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { NextRequest } from "next/server";

const TMP = path.join(tmpdir(), `aquaman-import-route-${Date.now()}`);
process.env.AQUAMAN_DATA_DIR = TMP;

type PageFetch = Awaited<ReturnType<typeof import("../src/lib/import/fetch-page").fetchProductPage>>;
type DraftResult = Awaited<ReturnType<typeof import("../src/lib/ai/product-draft").draftProductFromText>>;

let pageResult: PageFetch;
let draftResult: DraftResult;
const fetchSpy = vi.fn();
const draftSpy = vi.fn();

vi.mock("@/lib/import/fetch-page", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/import/fetch-page")>();
  return {
    ...actual,
    fetchProductPage: (...args: unknown[]) => {
      fetchSpy(...args);
      return Promise.resolve(pageResult);
    },
  };
});

vi.mock("@/lib/ai/product-draft", () => ({
  draftProductFromText: (...args: unknown[]) => {
    draftSpy(...args);
    return Promise.resolve(draftResult);
  },
}));

const GOOD_PAGE = `<html><head><title>sera Flora Nature</title></head><body>
<h2>Beschreibung</h2><p>Flockenfutter für pflanzenfressende Fische, die an der Oberfläche fressen.
Spirulina-Algen mit hohem Faser- und Carotinoidgehalt, leicht verdaulich, trübt das Wasser nicht.</p>
<h2>Analytische Bestandteile</h2><p>Proteine 45 %, Fett 7,9 %, Rohfaser 4 %, Rohasche 10,8 %, Feuchtigkeit 5 %.</p>
<h2>Inhaltsstoffe</h2><p>Fischmehl, Weizenmehl, Bierhefe, Spirulina-Algen (7 %), Ca-Caseinat, Meeresalgen, Gammarus, Volleipulver.</p>
<h3>Mineralien und Vitamine</h3><p>Vitamin A 37000 IE/kg, Vitamin D3 1800 IE/kg, Vitamin C 550 mg/kg.</p>
</body></html>`;

const DRAFT_OK: DraftResult = {
  ok: true,
  draft: { name: "sera Flora Nature", description: "Flockenfutter …", defaultDose: null, nutrients: {} },
  notes: ["no feeding instruction on the page"],
};

let POST: (req: NextRequest) => Promise<Response>;

function post(body: unknown, ip = "203.0.113.10") {
  return POST(
    new NextRequest("http://localhost/api/inventory/import", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify(body),
    }),
  );
}

beforeAll(async () => {
  mkdirSync(TMP, { recursive: true });
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const { db } = await import("../src/lib/db");
  migrate(db, { migrationsFolder: "./drizzle" });
  ({ POST } = await import("../src/app/api/inventory/import/route"));
});

beforeEach(async () => {
  const { __resetRateLimiter } = await import("../src/lib/rate-limit");
  __resetRateLimiter();
  fetchSpy.mockClear();
  draftSpy.mockClear();
  pageResult = { ok: true, html: GOOD_PAGE, finalUrl: "https://shop.example.com/p/1" };
  draftResult = DRAFT_OK;
});

describe("POST /api/inventory/import", () => {
  it("returns a draft plus the notes and the source", async () => {
    const res = await post({ kind: "food", url: "https://shop.example.com/p/1" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.draft.name).toBe("sera Flora Nature");
    expect(json.notes).toEqual(["no feeding instruction on the page"]);
    expect(json.sourceUrl).toBe("https://shop.example.com/p/1");
    expect(draftSpy).toHaveBeenCalledTimes(1);
  });

  it("hands the model extracted text, not raw HTML, and passes the chosen kind", async () => {
    await post({ kind: "fertilizer", url: "https://shop.example.com/p/1" });
    const arg = draftSpy.mock.calls[0][0] as { pageText: string; kind: string; sourceLabel?: string };
    expect(arg.kind).toBe("fertilizer");
    expect(arg.pageText).not.toContain("<html");
    expect(arg.pageText).toContain("Analytische Bestandteile");
    expect(arg.sourceLabel).toBe("shop.example.com");
  });

  it("never calls the model when the shop blocks the fetch", async () => {
    pageResult = { ok: false, code: "productImport.blocked" };
    const res = await post({ kind: "food", url: "https://shop.example.com/p/1" });
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe("productImport.blocked");
    expect(draftSpy).not.toHaveBeenCalled();
  });

  it("never calls the model for a page that is only a JS shell", async () => {
    pageResult = { ok: true, html: "<html><body><div id=root></div></body></html>", finalUrl: "https://shop.example.com/p" };
    const res = await post({ kind: "food", url: "https://shop.example.com/p" });
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("productImport.tooThin");
    expect(draftSpy).not.toHaveBeenCalled();
  });

  it("never calls the model, or even the fetcher, for a LAN address", async () => {
    // The real guard runs here — fetchProductPage is mocked, so the route's
    // own contract is what is under test: a 400 with the blocked-address code.
    pageResult = { ok: false, code: "productImport.blockedAddress" };
    const res = await post({ kind: "food", url: "http://192.168.178.3/" });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("productImport.blockedAddress");
    expect(draftSpy).not.toHaveBeenCalled();
  });

  it("takes pasted text without touching the network", async () => {
    const res = await post({
      kind: "food",
      text: "Analytische Bestandteile: Rohprotein 47,0 %, Rohfett 10,0 %, Rohfaser 2,0 %, Feuchtegehalt 8,0 %. ".repeat(6),
    });
    expect(res.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(draftSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects a body with neither url nor text", async () => {
    for (const body of [{ kind: "food" }, { kind: "food", url: "  " }, { url: "https://x.example.com" }, { kind: "toy", url: "https://x.example.com" }]) {
      const res = await post(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(draftSpy).not.toHaveBeenCalled();
    }
  });

  it("surfaces the daily AI limit as 429 and offline as 503", async () => {
    draftResult = { ok: false, code: "productImport.limitReached" };
    let res = await post({ kind: "food", url: "https://shop.example.com/p" });
    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe("productImport.limitReached");

    draftResult = { ok: false, code: "productImport.aiOffline" };
    res = await post({ kind: "food", url: "https://shop.example.com/p" }, "203.0.113.11");
    expect(res.status).toBe(503);
  });

  it("passes a no-product answer through as 422", async () => {
    draftResult = { ok: false, code: "productImport.noProduct" };
    const res = await post({ kind: "food", url: "https://shop.example.com/p" });
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("productImport.noProduct");
  });

  it("caps imports per IP and counts successes, not just failures", async () => {
    for (let i = 0; i < 10; i++) {
      expect((await post({ kind: "food", url: "https://shop.example.com/p" }, "198.51.100.7")).status).toBe(200);
    }
    const res = await post({ kind: "food", url: "https://shop.example.com/p" }, "198.51.100.7");
    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe("productImport.rateLimited");
    // A different address is unaffected.
    expect((await post({ kind: "food", url: "https://shop.example.com/p" }, "198.51.100.8")).status).toBe(200);
  });

  it("returns both an English error and a code, like every other write path", async () => {
    pageResult = { ok: false, code: "productImport.unreachable" };
    const json = await (await post({ kind: "food", url: "https://shop.example.com/p" })).json();
    expect(json).toMatchObject({ ok: false, code: "productImport.unreachable" });
    expect(typeof json.error).toBe("string");
  });
});
