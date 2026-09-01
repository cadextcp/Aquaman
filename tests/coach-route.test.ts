/**
 * Coach route tests (Phase 4) — guards first: no config → 503, bad input →
 * 400, budget exhausted → 429, rate limiting. The provider call itself is
 * mocked (no network in CI).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { NextRequest } from "next/server";

const TMP = path.join(tmpdir(), `aquaman-coach-route-${Date.now()}`);
process.env.AQUAMAN_DATA_DIR = TMP;

function coachReq(body: unknown, ip = "203.0.113.9"): NextRequest {
  return new NextRequest("http://localhost/api/coach", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

let tankAId = 0;
let tankBId = 0;

beforeAll(async () => {
  mkdirSync(TMP, { recursive: true });
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const { db } = await import("../src/lib/db");
  migrate(db, { migrationsFolder: "./drizzle" });

  const { tanks } = await import("../src/lib/db/schema");
  tankAId = db.insert(tanks).values({ name: "Tank A", volumeL: 60, waterType: "fresh" }).returning().get().id;
  tankBId = db.insert(tanks).values({ name: "Tank B", volumeL: 120, waterType: "fresh" }).returning().get().id;
});

afterAll(async () => {
  const { closeDb } = await import("./helpers");
  closeDb();
  rmSync(TMP, { recursive: true, force: true });
});

beforeEach(async () => {
  const { __resetRateLimiter } = await import("../src/lib/rate-limit");
  __resetRateLimiter();
  delete process.env.AQUAMAN_AI_API_KEY;
  delete process.env.AQUAMAN_AI_MODEL;
  delete process.env.AQUAMAN_AI_BASE_URL;
  delete process.env.AQUAMAN_AI_MAX_CALLS_PER_DAY;
  delete process.env.AQUAMAN_AI_MAX_TOKENS_PER_DAY;
});

// Mocked SDK (same pattern as ai-client-signal.test.ts) — only needed by the
// "tankId scope" describe below, which lets a request past every guard to
// inspect the actual system prompt handed to the provider. Harmless for
// every other test here: none of them reach streamCoachAnswer at all.
const streamSpy = vi.fn();
vi.mock("@anthropic-ai/sdk", () => {
  class FakeMessageStream {
    async *[Symbol.asyncIterator]() {
      /* empty stream — just enough for streamCoachAnswer to complete normally */
    }
  }
  class FakeAnthropic {
    messages = {
      stream: (...args: unknown[]) => {
        streamSpy(...args);
        return new FakeMessageStream();
      },
    };
  }
  class FakeAPIError extends Error {}
  return { default: FakeAnthropic, APIError: FakeAPIError };
});

describe("POST /api/coach — guards", () => {
  it("no AI config → 503 with friendly message", async () => {
    const { POST } = await import("../src/app/api/coach/route");
    const res = await POST(coachReq({ question: "hi" }));
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.error).toContain("not configured");
  });

  it("missing question → 400", async () => {
    process.env.AQUAMAN_AI_API_KEY = "test-key";
    process.env.AQUAMAN_AI_MODEL = "glm-4.6";
    const { POST } = await import("../src/app/api/coach/route");
    const res = await POST(coachReq({}));
    expect(res.status).toBe(400);
  });

  it("oversized question → 400", async () => {
    process.env.AQUAMAN_AI_API_KEY = "test-key";
    process.env.AQUAMAN_AI_MODEL = "glm-4.6";
    const { POST } = await import("../src/app/api/coach/route");
    const res = await POST(coachReq({ question: "x".repeat(3000) }));
    expect(res.status).toBe(400);
  });

  it("invalid JSON body → 400", async () => {
    process.env.AQUAMAN_AI_API_KEY = "test-key";
    process.env.AQUAMAN_AI_MODEL = "glm-4.6";
    const { POST } = await import("../src/app/api/coach/route");
    const res = await POST(coachReq("not-json{"));
    expect(res.status).toBe(400);
  });

  it("call budget exhausted → 429 'daily call limit'", async () => {
    process.env.AQUAMAN_AI_API_KEY = "test-key";
    process.env.AQUAMAN_AI_MODEL = "glm-4.6";
    process.env.AQUAMAN_AI_MAX_CALLS_PER_DAY = "1";
    const { recordAiCall } = await import("../src/lib/ai/cost-guard");
    recordAiCall({ provider: "anthropic", model: "m", purpose: "coach", promptTokens: 1, completionTokens: 1, costEstimateMicros: 0 });
    const { POST } = await import("../src/app/api/coach/route");
    const res = await POST(coachReq({ question: "hello" }));
    expect(res.status).toBe(429);
    const data = await res.json();
    expect(data.error).toContain("call limit");
  });

  it("token budget exhausted → 429 'daily token limit'", async () => {
    process.env.AQUAMAN_AI_API_KEY = "test-key";
    process.env.AQUAMAN_AI_MODEL = "glm-4.6";
    process.env.AQUAMAN_AI_MAX_TOKENS_PER_DAY = "1000";
    const { recordAiCall } = await import("../src/lib/ai/cost-guard");
    recordAiCall({ provider: "anthropic", model: "m", purpose: "coach", promptTokens: 600, completionTokens: 600, costEstimateMicros: 0 });
    const { POST } = await import("../src/app/api/coach/route");
    const res = await POST(coachReq({ question: "hello" }));
    expect(res.status).toBe(429);
    const data = await res.json();
    expect(data.error).toContain("token limit");
  });

  it("30 garbage requests from one IP → 429 rate limited", async () => {
    const { POST } = await import("../src/app/api/coach/route");
    const ip = "198.51.100.77";
    // 30 malformed requests accumulate failures
    for (let i = 0; i < 30; i++) {
      await POST(coachReq("garbage", ip));
    }
    process.env.AQUAMAN_AI_API_KEY = "test-key";
    process.env.AQUAMAN_AI_MODEL = "glm-4.6";
    const res = await POST(coachReq({ question: "hi" }, ip));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toContain("Too many");
  });

  it("malformed history entries → 400", async () => {
    process.env.AQUAMAN_AI_API_KEY = "test-key";
    process.env.AQUAMAN_AI_MODEL = "glm-4.6";
    const { POST } = await import("../src/app/api/coach/route");
    const res = await POST(coachReq({ question: "hi", history: [{ role: "evil", content: "x" }] }));
    expect(res.status).toBe(400);
  });

  describe("history length (review: a long real conversation must not permanently 400)", () => {
    // AI stays UNCONFIGURED in these — that's a fast, network-free way to
    // observe "did parseHistory accept this array and reach the next guard"
    // (503) vs. "was it rejected as malformed" (400), without needing a
    // live provider call once history validation passes.
    function historyOf(n: number) {
      return Array.from({ length: n }, (_, i) => ({ role: i % 2 === 0 ? "user" : "assistant", content: `m${i}` }));
    }

    it("history longer than MAX_HISTORY_MESSAGES is truncated, not rejected — reaches the next guard (503), not 400", async () => {
      const { POST } = await import("../src/app/api/coach/route");
      // 14 entries: exactly the case that broke a real conversation after
      // ~7 exchanges before this fix (see review) — every message shape is
      // well-formed, only the ARRAY LENGTH exceeds the cap.
      const res = await POST(coachReq({ question: "hi", history: historyOf(14) }));
      expect(res.status).toBe(503); // reached the "AI not configured" guard — history was accepted
    });

    it("a long conversation (20 simulated exchanges) never 400s on history length alone", async () => {
      const { POST } = await import("../src/app/api/coach/route");
      for (let n = 2; n <= 40; n += 2) {
        const res = await POST(coachReq({ question: `q${n}`, history: historyOf(n) }));
        expect(res.status).toBe(503); // never 400 — truncation keeps it flowing
      }
    });

    it("a genuinely oversized payload (bug/abuse, not a normal chat) is still rejected", async () => {
      const { POST } = await import("../src/app/api/coach/route");
      const res = await POST(coachReq({ question: "hi", history: historyOf(500) }));
      expect(res.status).toBe(400);
    });

    it("malformed entries are still rejected even inside an over-length array (truncation ≠ skip validation)", async () => {
      const { POST } = await import("../src/app/api/coach/route");
      const bad = [...historyOf(20), { role: "not-a-role", content: "x" }];
      const res = await POST(coachReq({ question: "hi", history: bad }));
      expect(res.status).toBe(400);
    });
  });
});

describe("POST /api/coach — tankId is mandatory (Coach page tank selector)", () => {
  it("missing tankId → 400 (after AI config/budget guards pass)", async () => {
    process.env.AQUAMAN_AI_API_KEY = "test-key";
    process.env.AQUAMAN_AI_MODEL = "glm-4.6";
    const { POST } = await import("../src/app/api/coach/route");
    const res = await POST(coachReq({ question: "hi" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("tankId");
  });

  it("tankId referencing a non-existent tank → 400", async () => {
    process.env.AQUAMAN_AI_API_KEY = "test-key";
    process.env.AQUAMAN_AI_MODEL = "glm-4.6";
    const { POST } = await import("../src/app/api/coach/route");
    const res = await POST(coachReq({ question: "hi", tankId: 999999 }));
    expect(res.status).toBe(400);
  });

  it("a non-integer/negative tankId → 400", async () => {
    process.env.AQUAMAN_AI_API_KEY = "test-key";
    process.env.AQUAMAN_AI_MODEL = "glm-4.6";
    const { POST } = await import("../src/app/api/coach/route");
    expect((await POST(coachReq({ question: "hi", tankId: -1 }))).status).toBe(400);
    expect((await POST(coachReq({ question: "hi", tankId: 1.5 }))).status).toBe(400);
    expect((await POST(coachReq({ question: "hi", tankId: "1" }))).status).toBe(400);
  });

  it("a valid tankId reaches the provider call with a system prompt scoped to ONLY that tank", async () => {
    process.env.AQUAMAN_AI_API_KEY = "test-key";
    process.env.AQUAMAN_AI_MODEL = "glm-4.6";
    streamSpy.mockClear();
    const { POST } = await import("../src/app/api/coach/route");
    const res = await POST(coachReq({ question: "how is my tank?", tankId: tankAId }));
    expect(res.status).toBe(200);
    expect(streamSpy).toHaveBeenCalledTimes(1);
    const system = (streamSpy.mock.calls[0][0] as { system: string }).system;
    expect(system).toContain("Tank A");
    expect(system).toContain("SCOPE:");
    expect(system).not.toContain("Tank B");
  });
});
