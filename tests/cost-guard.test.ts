/**
 * Cost guard tests (Phase 4) — two-tier limits, reset at local day boundary,
 * insert-only telemetry. Runs against a throwaway SQLite file.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

const TMP = path.join(tmpdir(), `aquaman-costguard-${Date.now()}`);
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

function cfg(over: Partial<{ maxCallsPerDay: number; maxTokensPerDay: number }> = {}) {
  return {
    baseUrl: "https://api.anthropic.com",
    apiKey: "test",
    model: "claude-sonnet-4-5",
    maxCallsPerDay: over.maxCallsPerDay ?? 20,
    maxTokensPerDay: over.maxTokensPerDay ?? 200_000,
  };
}

describe("cost guard", () => {
  it("fresh day: usage 0 → allowed", async () => {
    const { checkBudget, getUsage } = await import("../src/lib/ai/cost-guard");
    const config = cfg();
    const v = checkBudget(config);
    expect(v.allowed).toBe(true);
    expect(getUsage(config).calls).toBe(0);
  });

  it("calls limit trips first → reason 'calls'", async () => {
    const { checkBudget, recordAiCall } = await import("../src/lib/ai/cost-guard");
    const config = cfg({ maxCallsPerDay: 2, maxTokensPerDay: 10_000_000 });
    recordAiCall({ provider: "anthropic", model: "m", purpose: "coach", promptTokens: 10, completionTokens: 5, costEstimateMicros: 1 });
    recordAiCall({ provider: "anthropic", model: "m", purpose: "coach", promptTokens: 10, completionTokens: 5, costEstimateMicros: 1 });
    const v = checkBudget(config);
    expect(v.allowed).toBe(false);
    if (!v.allowed) expect(v.reason).toBe("calls");
  });

  it("token limit trips → reason 'tokens' (calls still under limit)", async () => {
    const { checkBudget, recordAiCall } = await import("../src/lib/ai/cost-guard");
    const config = cfg({ maxCallsPerDay: 100, maxTokensPerDay: 50 });
    recordAiCall({ provider: "anthropic", model: "m", purpose: "coach", promptTokens: 30, completionTokens: 25, costEstimateMicros: 1 });
    const v = checkBudget(config);
    expect(v.allowed).toBe(false);
    if (!v.allowed) expect(v.reason).toBe("tokens");
  });

  it("usage resets on the next local day (no cron — checked on demand)", async () => {
    const { checkBudget, recordAiCall, usageDay } = await import("../src/lib/ai/cost-guard");
    const config = cfg({ maxCallsPerDay: 1 });
    // yesterday's row must not block today
    const { db } = await import("../src/lib/db");
    const { aiCalls } = await import("../src/lib/db/schema");
    const yesterday = usageDay(new Date(Date.now() - 86_400_000));
    db.insert(aiCalls).values({
      day: yesterday, provider: "anthropic", model: "m",
      promptTokens: 9999, completionTokens: 9999, costEstimateMicros: 1, purpose: "coach",
    }).run();
    recordAiCall({ provider: "anthropic", model: "m", purpose: "coach", promptTokens: 1, completionTokens: 1, costEstimateMicros: 0 });
    const v = checkBudget(config);
    expect(v.allowed).toBe(false); // today has 1 call = limit
    const nextDay = checkBudget(config, new Date(Date.now() + 86_400_000));
    expect(nextDay.allowed).toBe(true); // tomorrow it's free again
  });

  it("records purpose and keeps one row per call (audit trail)", async () => {
    const { recordAiCall, getUsage } = await import("../src/lib/ai/cost-guard");
    const config = cfg();
    recordAiCall({ provider: "zai", model: "glm-4.6", purpose: "propose_schedule", promptTokens: 100, completionTokens: 200, costEstimateMicros: 5 });
    const u = getUsage(config);
    expect(u.calls).toBeGreaterThanOrEqual(1);
    expect(u.totalTokens).toBeGreaterThanOrEqual(300);
  });

  it("usageForSettings works without config", async () => {
    const { usageForSettings } = await import("../src/lib/ai/cost-guard");
    const s = usageForSettings();
    expect(typeof s.calls).toBe("number");
    expect(typeof s.totalTokens).toBe("number");
  });
});

describe("reserveCallSlot / releaseCallSlot (review: closes the checkBudget race)", () => {
  // Earlier tests in this file commit real aiCalls rows for TODAY, so a
  // fresh 0-usage day is needed here — use a distinct synthetic future day
  // per test (isolated from both earlier tests AND from each other).
  let dayOffset = 10;
  function freshNow(): Date {
    dayOffset += 1;
    return new Date(Date.now() + dayOffset * 86_400_000);
  }

  it("reserving up to the limit succeeds; one more fails without a matching release", async () => {
    const { reserveCallSlot, __resetPendingCallSlots } = await import("../src/lib/ai/cost-guard");
    __resetPendingCallSlots();
    const now = freshNow();
    const config = cfg({ maxCallsPerDay: 2, maxTokensPerDay: 10_000_000 });
    const a = reserveCallSlot(config, now);
    const b = reserveCallSlot(config, now);
    const c = reserveCallSlot(config, now);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(c.ok).toBe(false); // 3rd reservation exceeds maxCallsPerDay=2, with nothing committed yet
  });

  it("two near-simultaneous requests can't both slip past a 1-call limit (the actual race)", async () => {
    const { reserveCallSlot, __resetPendingCallSlots } = await import("../src/lib/ai/cost-guard");
    __resetPendingCallSlots();
    const now = freshNow();
    const config = cfg({ maxCallsPerDay: 1, maxTokensPerDay: 10_000_000 });
    // simulates two requests calling reserveCallSlot back-to-back, BEFORE
    // either has a chance to commit a row via recordAiCall (the exact
    // interleaving that let both pass a plain checkBudget check)
    const first = reserveCallSlot(config, now);
    const second = reserveCallSlot(config, now);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
  });

  it("release frees the slot for a later reservation on the same day", async () => {
    const { reserveCallSlot, releaseCallSlot, __resetPendingCallSlots } = await import("../src/lib/ai/cost-guard");
    __resetPendingCallSlots();
    const now = freshNow();
    const config = cfg({ maxCallsPerDay: 1, maxTokensPerDay: 10_000_000 });
    const first = reserveCallSlot(config, now);
    expect(first.ok).toBe(true);
    releaseCallSlot(first.day);
    const second = reserveCallSlot(config, now);
    expect(second.ok).toBe(true); // freed by the release, not still blocked
  });

  it("a reservation plus an already-committed call together respect the limit", async () => {
    const { reserveCallSlot, recordAiCall, __resetPendingCallSlots } = await import("../src/lib/ai/cost-guard");
    __resetPendingCallSlots();
    const now = freshNow();
    const config = cfg({ maxCallsPerDay: 2, maxTokensPerDay: 10_000_000 });
    recordAiCall({ provider: "anthropic", model: "m", purpose: "coach", promptTokens: 1, completionTokens: 1, costEstimateMicros: 0, now });
    const a = reserveCallSlot(config, now); // 1 committed + this reservation = 2 → still allowed
    const b = reserveCallSlot(config, now); // would make 3 → over the limit of 2
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(false);
  });
});
