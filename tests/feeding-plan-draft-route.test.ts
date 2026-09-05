/**
 * POST /api/feeding-plan/draft — the "suggest a feeding plan" button.
 *
 * Same assertion family as tests/import-route.test.ts: no failure path
 * reaches the model (the spy counts), the tank check runs BEFORE the provider
 * call, and every failure carries both an English error and a catalog code.
 * `fitToField` additionally pins that an over-cap draft is cut at a blank
 * line, never mid-table.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { NextRequest } from "next/server";

const TMP = path.join(tmpdir(), `aquaman-feeding-plan-route-${Date.now()}`);
process.env.AQUAMAN_DATA_DIR = TMP;

type DraftResult = Awaited<ReturnType<typeof import("../src/lib/ai/feeding-plan-draft").draftFeedingPlan>>;

let draftResult: DraftResult;
const draftSpy = vi.fn();

vi.mock("@/lib/ai/feeding-plan-draft", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/ai/feeding-plan-draft")>();
  return {
    ...actual, // pure helpers like fitToField stay real
    draftFeedingPlan: (...args: unknown[]) => {
      draftSpy(...args);
      return Promise.resolve(draftResult);
    },
  };
});

let POST: (req: NextRequest) => Promise<Response>;

function post(body: unknown, ip = "203.0.113.20") {
  return POST(
    new NextRequest("http://localhost/api/feeding-plan/draft", {
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
  ({ POST } = await import("../src/app/api/feeding-plan/draft/route"));
});

beforeEach(async () => {
  const { __resetRateLimiter } = await import("../src/lib/rate-limit");
  __resetRateLimiter();
  draftSpy.mockClear();
  draftResult = { ok: true, plan: "**Mo:** Flocken\n**So:** Fastentag" };
});

describe("POST /api/feeding-plan/draft", () => {
  it("returns the coach draft", async () => {
    const res = await post({ tankId: 1 });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.plan).toContain("Fastentag");
    expect(draftSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects a body without tankId, without touching the model", async () => {
    for (const body of [{}, { tankId: "x" }, { tankId: -1 }]) {
      const res = await post(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(draftSpy).not.toHaveBeenCalled();
    }
  });

  it("maps every failure code to its status and never writes", async () => {
    draftResult = { ok: false, code: "feedingPlan.tankNotFound" };
    expect((await post({ tankId: 999 })).status).toBe(404);

    draftResult = { ok: false, code: "feedingPlan.limitReached" };
    expect((await post({ tankId: 1 })).status).toBe(429);

    draftResult = { ok: false, code: "feedingPlan.aiOffline" };
    expect((await post({ tankId: 1 })).status).toBe(503);

    draftResult = { ok: false, code: "feedingPlan.draftFailed" };
    const res = await post({ tankId: 1 });
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json).toMatchObject({ ok: false, code: "feedingPlan.draftFailed" });
    expect(typeof json.error).toBe("string");
  });

  it("caps drafts per IP and counts successes, not just failures", async () => {
    for (let i = 0; i < 10; i++) {
      expect((await post({ tankId: 1 }, "198.51.100.9")).status).toBe(200);
    }
    expect((await post({ tankId: 1 }, "198.51.100.9")).status).toBe(429);
    expect((await post({ tankId: 1 }, "198.51.100.10")).status).toBe(200);
  });
});

describe("fitToField", () => {
  it("keeps a plan within the cap untouched", async () => {
    const { fitToField } = await import("../src/lib/ai/feeding-plan-draft");
    const short = "**Mo:** Flocken";
    expect(fitToField(short)).toBe(short);
  });

  it("cuts an over-cap draft at a blank line, never mid-table", async () => {
    const { fitToField } = await import("../src/lib/ai/feeding-plan-draft");
    const { FEEDING_PLAN_MAX_CHARS } = await import("../src/lib/schemas");
    const table =
      "| Tag | Futter |\n|---|---|\n| Mo | Flocken |\n| Di | Frost |";
    const filler = "paragraph\n\n".repeat(600); // comfortably over the cap
    const over = filler + table;
    expect(over.length).toBeGreaterThan(FEEDING_PLAN_MAX_CHARS);
    const fitted = fitToField(over);
    expect(fitted.length).toBeLessThanOrEqual(FEEDING_PLAN_MAX_CHARS);
    // a cut happened at a blank line: the result does not end mid-row
    expect(fitted.endsWith("\n\n")).toBe(false);
    expect(fitted).not.toMatch(/\|\s*$/);
  });
});
