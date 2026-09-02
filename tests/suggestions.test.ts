/**
 * Daily-suggestions tests (issue #41): cache semantics (per local day),
 * zod rejection of malformed model output, budget/off behavior of the route.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { NextRequest } from "next/server";

const TMP = path.join(tmpdir(), `aquaman-sugg-${Date.now()}`);
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

beforeEach(async () => {
  const { db } = await import("../src/lib/db");
  const { appSettings } = await import("../src/lib/db/schema");
  const { eq } = await import("drizzle-orm");
  db.delete(appSettings).where(eq(appSettings.key, "coachSuggestions.v1")).run();
  delete process.env.AQUAMAN_AI_API_KEY;
  delete process.env.AQUAMAN_AI_MODEL;
});

describe("suggestion cache (issue #41)", () => {
  it("save + read round-trip; stale day = miss", async () => {
    const { saveDailySuggestions, getDailySuggestions } = await import("../src/lib/settings");
    const saved = saveDailySuggestions([{ label: "Suggest a fertilization plan", prompt: "Please suggest a fertilization plan for my tanks." }]);
    expect(saved.items).toHaveLength(1);
    const now = new Date();
    expect(getDailySuggestions(now)?.items[0].label).toContain("fertilization");
    // yesterday's cache entry → miss
    expect(getDailySuggestions(new Date(now.getTime() - 86400000))).toBeNull();
  });

  it("a cache entry from another language is a miss (chips are coach output)", async () => {
    const { saveDailySuggestions, getDailySuggestions, saveGlobalSettings } = await import("../src/lib/settings");
    saveGlobalSettings({ locale: "en" });
    saveDailySuggestions([{ label: "Suggest a fertilization plan", prompt: "Please suggest a fertilization plan." }]);
    expect(getDailySuggestions(new Date())).not.toBeNull();

    saveGlobalSettings({ locale: "de" });
    // English chips must not linger in a German UI — a miss regenerates them
    expect(getDailySuggestions(new Date())).toBeNull();

    saveGlobalSettings({ locale: "en" });
    expect(getDailySuggestions(new Date())).not.toBeNull();
  });

  it("a pre-i18n cache entry (no locale) is a miss rather than a crash", async () => {
    const { db } = await import("../src/lib/db");
    const { appSettings } = await import("../src/lib/db/schema");
    const { getDailySuggestions } = await import("../src/lib/settings");
    const day = new Date().toISOString().slice(0, 10);
    db.insert(appSettings)
      .values({ key: "coachSuggestions.v1", value: { day, items: [{ label: "old chip", prompt: "old prompt" }] } as never })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: { day, items: [{ label: "old chip", prompt: "old prompt" }] } as never } })
      .run();
    expect(getDailySuggestions(new Date())).toBeNull();
  });

  it("malformed model output rejected by zod", async () => {
    const { parseSuggestions } = await import("../src/lib/ai/proposal");
    expect(parseSuggestions({ day: "2026-08-24", items: [] })).toBeNull();
    expect(parseSuggestions({ day: "2026-08-24", items: [{ label: "x", prompt: "y" }, { label: "", prompt: "z" }] })).toBeNull();
    expect(parseSuggestions(null)).toBeNull();
    expect(parseSuggestions({ day: "24-08-2026", items: [{ label: "ok label", prompt: "ok prompt" }] })).toBeNull();
  });
});

describe("GET /api/coach/suggestions", () => {
  it("AI unconfigured → 503 (UI hides chips)", async () => {
    const { GET } = await import("../src/app/api/coach/suggestions/route");
    const res = await GET(new NextRequest("http://localhost/api/coach/suggestions"));
    expect(res.status).toBe(503);
  });

  it("serves from cache without provider call", async () => {
    const { saveDailySuggestions } = await import("../src/lib/settings");
    saveDailySuggestions([
      { label: "Why is NH₃ rising?", prompt: "Why is NH₃ rising and what should I do?" },
    ]);
    const { GET } = await import("../src/app/api/coach/suggestions/route");
    const res = await GET(new NextRequest("http://localhost/api/coach/suggestions"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.cached).toBe(true);
    expect(data.items[0].label).toContain("NH₃");
  });

  it("budget exhausted → quiet empty list (no alarming error)", async () => {
    process.env.AQUAMAN_AI_API_KEY = "k";
    process.env.AQUAMAN_AI_MODEL = "glm-5.3";
    process.env.AQUAMAN_AI_MAX_CALLS_PER_DAY = "1";
    const { recordAiCall } = await import("../src/lib/ai/cost-guard");
    recordAiCall({ provider: "zai", model: "glm-5.3", purpose: "coach", promptTokens: 1, completionTokens: 1, costEstimateMicros: 0 });
    const { GET } = await import("../src/app/api/coach/suggestions/route");
    const res = await GET(new NextRequest("http://localhost/api/coach/suggestions"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.items).toEqual([]);
    expect(data.reason).toBe("budget");
    delete process.env.AQUAMAN_AI_MAX_CALLS_PER_DAY;
  });
});
