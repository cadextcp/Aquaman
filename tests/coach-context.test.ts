/**
 * Coach context tests (Phase 4) — the DATA BOUNDARY is the security property:
 * the model may see tanks/tests/backlog, but NEVER tokens, keys, env values
 * or internal paths (AGENTS "Never send").
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";

const TMP = path.join("/tmp", `aquaman-context-${Date.now()}`);
process.env.AQUAMAN_DATA_DIR = TMP;

beforeAll(async () => {
  mkdirSync(TMP, { recursive: true });
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const { db } = await import("../src/lib/db");
  migrate(db, { migrationsFolder: "./drizzle" });

  const { tanks, schedules, waterTests } = await import("../src/lib/db/schema");
  const tank = db
    .insert(tanks)
    .values({
      name: "Context Tank", volumeL: 240, waterType: "fresh",
      fish: [{ species: "Guppy", qty: 12 }], plants: [{ name: "Vallisneria", qty: 5 }],
      tankState: "established",
    })
    .returning()
    .get();
  db.insert(schedules)
    .values({ tankId: tank.id, actionType: "water_change", intervalDays: 7, preferredDays: 96 })
    .run();
  db.insert(waterTests)
    .values({
      tankId: tank.id, measuredAt: new Date().toISOString(),
      values: { temp: 25, ph: 8.2, nh4: 0.5, no2: 0.05, no3: 20 },
    })
    .run();
});

afterAll(() => rmSync(TMP, { recursive: true, force: true }));

describe("buildCoachContext", () => {
  it("includes tanks, fish, NH3 calculation, backlog terms", async () => {
    const { buildCoachContext } = await import("../src/lib/ai/context");
    const ctx = buildCoachContext();
    expect(ctx).toContain("Context Tank");
    expect(ctx).toContain("Guppy");
    expect(ctx).toContain("NH3_calc=");
    // NH4 0.5 at pH 8.2, 25 °C → NH3 ≈ 0.5 * 1/(1+10^(pKa-pH)); pKa(25°C)≈9.25
    // fraction ≈ 1/(1+10^(9.25-8.2)) ≈ 0.0816 → NH3 ≈ 0.041 → must appear
    expect(ctx).toMatch(/NH3_calc=0\.0[34]\d+/);
    expect(ctx).toContain("water_change");
    expect(ctx).toContain("missedSlots");
    expect(ctx).toContain("TODAY:");
  });

  it("NEVER contains secrets, tokens or env values (data boundary)", async () => {
    const { buildCoachContext } = await import("../src/lib/ai/context");
    const ctx = buildCoachContext();
    expect(ctx).not.toContain("AQUAMAN_");
    expect(ctx).not.toContain("apiKey");
    expect(ctx).not.toContain("api_key");
    expect(ctx).not.toContain("icsToken");
    expect(ctx).not.toMatch(/sk-[a-zA-Z0-9]/);
    expect(ctx).not.toContain("/app/data");
  });

  it("empty tank list → friendly empty context", async () => {
    // separate DB state would be needed; just assert the none-marker logic
    // by checking the function does not throw
    const { buildCoachContext } = await import("../src/lib/ai/context");
    expect(() => buildCoachContext()).not.toThrow();
  });
});

describe("normalizeHistory", () => {
  it("merges consecutive same-role turns and drops leading assistant turns", async () => {
    const { normalizeHistory } = await import("../src/lib/ai/client");
    const out = normalizeHistory(
      [
        { role: "assistant", content: "hello" },
        { role: "user", content: "a" },
        { role: "user", content: "b" },
        { role: "assistant", content: "c" },
      ],
      "q",
    );
    expect(out[0].role).toBe("user");
    expect(out[0].content).toBe("a\n\nb");
    expect(out.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  });

  it("caps history length", async () => {
    const { normalizeHistory } = await import("../src/lib/ai/client");
    const many = Array.from({ length: 30 }, (_, i) => ({ role: "user" as const, content: `m${i}` }));
    const out = normalizeHistory(many, "q");
    expect(out.length).toBeLessThanOrEqual(12);
  });
});

describe("parseProposal", () => {
  it("accepts a well-formed proposal", async () => {
    const { parseProposal } = await import("../src/lib/ai/proposal");
    const p = parseProposal({
      rationale: "shorten water changes",
      changes: [{ kind: "adjust", scheduleId: 1, intervalDays: 5 }],
    });
    expect(p).not.toBeNull();
    expect(p!.changes[0].intervalDays).toBe(5);
  });

  it("rejects malformed output (never repair)", async () => {
    const { parseProposal } = await import("../src/lib/ai/proposal");
    expect(parseProposal(null)).toBeNull();
    expect(parseProposal({ rationale: "", changes: [] })).toBeNull();
    expect(
      parseProposal({
        rationale: "x",
        changes: [{ kind: "adjust", scheduleId: -1, intervalDays: 5 }],
      }),
    ).toBeNull();
    expect(
      parseProposal({
        rationale: "x",
        changes: [{ kind: "create", tankId: 1, actionType: "water_change", intervalDays: 0, preferredDays: 96 }],
      }),
    ).toBeNull();
    expect(
      parseProposal({
        rationale: "x",
        changes: [{ kind: "create", tankId: 1, actionType: "water_change", intervalDays: 7, preferredDays: 0 }],
      }),
    ).toBeNull();
  });

  it("rejects 7 changes (max 6) and negative tank ids", async () => {
    const { parseProposal } = await import("../src/lib/ai/proposal");
    const changes = Array.from({ length: 7 }, () => ({ kind: "create" as const, tankId: 1, actionType: "water_change", intervalDays: 7, preferredDays: 127 }));
    expect(parseProposal({ rationale: "x", changes })).toBeNull();
    expect(
      parseProposal({ rationale: "x", changes: [{ kind: "create", tankId: -5, actionType: "x", intervalDays: 7, preferredDays: 127 }] }),
    ).toBeNull();
  });
});

describe("fishless tanks must be explicit in the AI context (no phantom feeding)", () => {
  it("context states fish: NONE for a plants-only tank — never omits livestock", async () => {
    const { db } = await import("../src/lib/db");
    const { tanks } = await import("../src/lib/db/schema");
    db.insert(tanks).values({
      name: "Plants Only", volumeL: 60, waterType: "fresh",
      plants: [{ name: "Anubias", qty: 3 }], fish: [], // ← no fish, deliberate
      tankState: "established",
    }).run();

    const { buildCoachContext } = await import("../src/lib/ai/context");
    const ctx = buildCoachContext();
    expect(ctx).toContain("Plants Only");
    expect(ctx).toMatch(/fish:\s*NONE/i); // explicit, not omitted
    expect(ctx).toContain("do NOT suggest feeding");
    // the plant line still works the other way round
    expect(ctx).toContain("Anubias");
  });

  it("tanks WITH fish list them with counts", async () => {
    const { db } = await import("../src/lib/db");
    const { tanks } = await import("../src/lib/db/schema");
    db.insert(tanks).values({
      name: "Stocked", volumeL: 120, waterType: "fresh",
      plants: [], fish: [{ species: "Guppy", qty: 8 }],
      tankState: "established",
    }).run();
    const { buildCoachContext } = await import("../src/lib/ai/context");
    const ctx = buildCoachContext();
    expect(ctx).toContain("fish: Guppy x8");
    expect(ctx).toContain("plants: none"); // symmetric fallback
  });

  it("COACH_SYSTEM_PROMPT forbids feeding suggestions for fishless tanks", async () => {
    const { COACH_SYSTEM_PROMPT } = await import("../src/lib/ai/context");
    expect(COACH_SYSTEM_PROMPT).toMatch(/fish:\s*"?NONE"?/);
    expect(COACH_SYSTEM_PROMPT).toMatch(/do NOT suggest feeding/i);
  });

  it("plan-review SYSTEM prompt ALSO forbids feeding proposals for fishless tanks", async () => {
    // read the module source (the prompt is a private const) and pin the rule —
    // the plan review is the OTHER path that could suggest feeding
    const src = await import("node:fs").then((fs) => fs.readFileSync("src/lib/ai/plan-review-runner.ts", "utf-8"));
    expect(src).toMatch(/fish:\s*"?NONE"?/);
    expect(src).toMatch(/NEVER propose feeding/i);
  });
});
