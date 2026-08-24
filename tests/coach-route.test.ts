/**
 * Coach route tests (Phase 4) — guards first: no config → 503, bad input →
 * 400, budget exhausted → 429, rate limiting. The provider call itself is
 * mocked (no network in CI).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";

const TMP = path.join("/tmp", `aquaman-coach-route-${Date.now()}`);
process.env.AQUAMAN_DATA_DIR = TMP;

function coachReq(body: unknown, ip = "203.0.113.9"): NextRequest {
  return new NextRequest("http://localhost/api/coach", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeAll(async () => {
  mkdirSync(TMP, { recursive: true });
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const { db } = await import("../src/lib/db");
  migrate(db, { migrationsFolder: "./drizzle" });
});

afterAll(() => rmSync(TMP, { recursive: true, force: true }));

beforeEach(async () => {
  const { __resetRateLimiter } = await import("../src/lib/rate-limit");
  __resetRateLimiter();
  delete process.env.AQUAMAN_AI_API_KEY;
  delete process.env.AQUAMAN_AI_MODEL;
  delete process.env.AQUAMAN_AI_BASE_URL;
  delete process.env.AQUAMAN_AI_MAX_CALLS_PER_DAY;
  delete process.env.AQUAMAN_AI_MAX_TOKENS_PER_DAY;
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
});
