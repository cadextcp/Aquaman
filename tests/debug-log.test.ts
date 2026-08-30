/**
 * AI debug log tests (More → Debug): insert-and-list round trip, secrets
 * never leak into the stored request, and the table is pruned to the most
 * recent 200 rows so it can never grow without bound (unlike aiCalls, this
 * table is a debugging aid, not a permanent audit trail).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

const TMP = path.join(tmpdir(), `aquaman-debuglog-${Date.now()}`);
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

describe("ai call debug log", () => {
  it("records a call and lists it most-recent-first", async () => {
    const { logAiCall, listAiCallLogs } = await import("../src/lib/ai/debug-log");
    logAiCall({
      purpose: "coach",
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      request: { system: "you are a coach", messages: [{ role: "user", content: "hi" }] },
      response: { text: "hello!" },
      error: null,
      durationMs: 42,
    });
    const logs = listAiCallLogs(10);
    expect(logs.length).toBeGreaterThan(0);
    const latest = logs[0];
    expect(latest.purpose).toBe("coach");
    expect(latest.provider).toBe("anthropic");
    expect(latest.error).toBeNull();
    expect(JSON.parse(latest.requestJson)).toEqual({ system: "you are a coach", messages: [{ role: "user", content: "hi" }] });
    expect(JSON.parse(latest.responseJson!)).toEqual({ text: "hello!" });
  });

  it("a failed call is stored with null response and the error message", async () => {
    const { logAiCall, listAiCallLogs } = await import("../src/lib/ai/debug-log");
    logAiCall({
      purpose: "plan_review",
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      request: { system: "review" },
      response: null,
      error: "provider unreachable",
      durationMs: 5,
    });
    const latest = listAiCallLogs(1)[0];
    expect(latest.purpose).toBe("plan_review");
    expect(latest.responseJson).toBeNull();
    expect(latest.error).toBe("provider unreachable");
  });

  it("never contains the API key, only the request/response payload passed in", async () => {
    const { logAiCall, listAiCallLogs } = await import("../src/lib/ai/debug-log");
    logAiCall({
      purpose: "suggestions",
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      request: { system: "sys", messages: [] },
      response: { content: [] },
      error: null,
      durationMs: 1,
    });
    const latest = listAiCallLogs(1)[0];
    expect(latest.requestJson).not.toContain("sk-ant");
    expect(latest.requestJson).not.toContain("apiKey");
  });

  it("prunes to the most recent 200 rows", async () => {
    const { logAiCall, listAiCallLogs } = await import("../src/lib/ai/debug-log");
    const { db } = await import("../src/lib/db");
    const { aiCallLogs } = await import("../src/lib/db/schema");
    db.delete(aiCallLogs).run();

    for (let i = 0; i < 205; i++) {
      logAiCall({
        purpose: "coach",
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        request: { i },
        response: { i },
        error: null,
        durationMs: 1,
      });
    }
    const all = db.select().from(aiCallLogs).all();
    expect(all.length).toBe(200);
    // the oldest 5 (i = 0..4) were dropped; the most recent survives
    const newest = listAiCallLogs(1)[0];
    expect(JSON.parse(newest.requestJson)).toEqual({ i: 204 });
  });
});
