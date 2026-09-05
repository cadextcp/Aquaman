/**
 * POST /api/more/prompts/test — same assertion family as the import route:
 * no failure path reaches the model (the spy counts), validation runs in the
 * ROUTE (so the editor gets the reason), and the rate limit is the route's own.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { NextRequest } from "next/server";

const TMP = path.join(tmpdir(), `aquaman-prompt-test-route-${Date.now()}`);
process.env.AQUAMAN_DATA_DIR = TMP;

const runSpy = vi.fn();
let runResult: Awaited<ReturnType<typeof import("../src/lib/ai/prompt-test").runPromptTest>>;

vi.mock("@/lib/ai/prompt-test", () => ({
  runPromptTest: (...args: unknown[]) => {
    runSpy(...args);
    return Promise.resolve(runResult);
  },
}));

let POST: (req: NextRequest) => Promise<Response>;

function post(body: unknown, ip = "203.0.113.30") {
  return POST(
    new NextRequest("http://localhost/api/more/prompts/test", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify(body),
    }),
  );
}

const VALID_COACH = "Be terse.\n\n{{context}}";

beforeAll(async () => {
  mkdirSync(TMP, { recursive: true });
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const { db } = await import("../src/lib/db");
  migrate(db, { migrationsFolder: "./drizzle" });
  ({ POST } = await import("../src/app/api/more/prompts/test/route"));
});

beforeEach(async () => {
  const { __resetRateLimiter } = await import("../src/lib/rate-limit");
  __resetRateLimiter();
  runSpy.mockClear();
  runResult = { ok: true, kind: "coach", answer: "Short answer.", proposal: null, usage: { promptTokens: 10, completionTokens: 5, costEstimateMicros: 1 } };
});

describe("POST /api/more/prompts/test", () => {
  it("passes a valid request through and returns the inert payload", async () => {
    const res = await post({ promptId: "coach", system: VALID_COACH, question: "Nitrate?" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.kind).toBe("coach");
    expect(runSpy).toHaveBeenCalledTimes(1);
  });

  it("requires a question for the coach prompt — 400, model never called", async () => {
    const res = await post({ promptId: "coach", system: VALID_COACH });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("prompt.invalid");
    expect(runSpy).not.toHaveBeenCalled();
  });

  it("rejects an invalid system in the ROUTE, with the reason as detail", async () => {
    const res = await post({ promptId: "coach", system: "No context here.", question: "Hi" });
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.code).toBe("prompt.invalid");
    expect(json.vars.detail).toContain("{{context}} is required");
    expect(runSpy).not.toHaveBeenCalled();
  });

  it("maps engine failures: rate limit 429, offline 503, budget 429", async () => {
    runResult = { ok: false, code: "prompt.rateLimited" };
    expect((await post({ promptId: "suggestions", system: "R\n\n{{context}}" })).status).toBe(429);

    runResult = { ok: false, code: "prompt.aiOffline" };
    expect((await post({ promptId: "suggestions", system: "R\n\n{{context}}" })).status).toBe(503);

    runResult = { ok: false, code: "prompt.limitReached" };
    expect((await post({ promptId: "suggestions", system: "R\n\n{{context}}" })).status).toBe(429);
  });

  it("caps tests per IP at 10/hour", async () => {
    for (let i = 0; i < 10; i++) {
      expect((await post({ promptId: "suggestions", system: "R\n\n{{context}}" }, "198.51.100.11")).status).toBe(200);
    }
    const res = await post({ promptId: "suggestions", system: "R\n\n{{context}}" }, "198.51.100.11");
    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe("prompt.rateLimited");
    expect((await post({ promptId: "suggestions", system: "R\n\n{{context}}" }, "198.51.100.12")).status).toBe(200);
  });
});
