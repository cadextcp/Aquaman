/**
 * Plan review tests: state machine transitions, trigger guards, route behavior
 * (AI-off and budget cases resolve to idle instead of leaving a stuck state).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { vi } from "vitest";
import { NextRequest } from "next/server";

const TMP = path.join(tmpdir(), `aquaman-planreview-${Date.now()}`);
process.env.AQUAMAN_DATA_DIR = TMP;

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

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
  db.delete(appSettings).where(eq(appSettings.key, "planReview.v1")).run();
  delete process.env.AQUAMAN_AI_API_KEY;
  delete process.env.AQUAMAN_AI_MODEL;
});

describe("plan review state machine", () => {
  it("idle by default; request → pending; reviewed → idle", async () => {
    const m = await import("../src/lib/ai/plan-review");
    expect(m.getPlanReviewState().state).toBe("idle");
    m.requestPlanReview("tank_change");
    const pending = m.getPlanReviewState();
    expect(pending.state).toBe("pending");
    if (pending.state === "pending") expect(pending.reason).toBe("tank_change");
    m.markPlanReviewed();
    expect(m.getPlanReviewState().state).toBe("idle");
  });

  it("request during thinking does NOT interrupt the running review", async () => {
    const m = await import("../src/lib/ai/plan-review");
    const { db } = await import("../src/lib/db");
    const { appSettings } = await import("../src/lib/db/schema");
    // simulate a running review
    db.insert(appSettings)
      .values({ key: m.PLAN_REVIEW_KEY, value: { state: "thinking", reason: "water_test", since: "x" } as never })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: { state: "thinking", reason: "water_test", since: "x" } as never } })
      .run();
    m.requestPlanReview("tank_change");
    const cur = m.getPlanReviewState();
    expect(cur.state).toBe("thinking"); // still the old review
    if (cur.state === "thinking") expect(cur.reason).toBe("water_test");
  });

  it("corrupt stored state falls back to idle", async () => {
    const m = await import("../src/lib/ai/plan-review");
    const { db } = await import("../src/lib/db");
    const { appSettings } = await import("../src/lib/db/schema");
    db.insert(appSettings)
      .values({ key: m.PLAN_REVIEW_KEY, value: { nonsense: true } as never })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: { nonsense: true } as never } })
      .run();
    expect(m.getPlanReviewState().state).toBe("idle");
  });
});

describe("POST /api/coach/plan-review", () => {
  it("AI unconfigured + pending → resolves to idle (no stuck pending)", async () => {
    const { requestPlanReview } = await import("../src/lib/ai/plan-review");
    requestPlanReview("tank_change");
    const { POST } = await import("../src/app/api/coach/plan-review/route");
    const res = await POST(
      new NextRequest("http://localhost/api/coach/plan-review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.state).toBe("idle");
    expect(data.reason).toBe("ai-off");
  });

  it("budget exhausted + pending → resolves to idle with reason budget", async () => {
    process.env.AQUAMAN_AI_API_KEY = "k";
    process.env.AQUAMAN_AI_MODEL = "glm-5.3";
    process.env.AQUAMAN_AI_MAX_CALLS_PER_DAY = "1";
    const { recordAiCall } = await import("../src/lib/ai/cost-guard");
    recordAiCall({ provider: "zai", model: "glm-5.3", purpose: "coach", promptTokens: 1, completionTokens: 1, costEstimateMicros: 0 });
    const { requestPlanReview } = await import("../src/lib/ai/plan-review");
    requestPlanReview("water_test");
    const { POST } = await import("../src/app/api/coach/plan-review/route");
    const res = await POST(
      new NextRequest("http://localhost/api/coach/plan-review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      }),
    );
    const data = await res.json();
    expect(data.state).toBe("idle");
    expect(data.reason).toBe("budget");
    delete process.env.AQUAMAN_AI_MAX_CALLS_PER_DAY;
  });

  it("action reviewed → idle", async () => {
    const { requestPlanReview } = await import("../src/lib/ai/plan-review");
    requestPlanReview("tank_change");
    const { POST } = await import("../src/app/api/coach/plan-review/route");
    const res = await POST(
      new NextRequest("http://localhost/api/coach/plan-review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "reviewed" }),
      }),
    );
    const data = await res.json();
    expect(data.state).toBe("idle");
  });

  it("unknown action → 400", async () => {
    const { POST } = await import("../src/app/api/coach/plan-review/route");
    const res = await POST(
      new NextRequest("http://localhost/api/coach/plan-review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "bogus" }),
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("trigger wiring (actions)", () => {
  it("updateTank with master-data change sets pending(tank_change)", async () => {
    const { createTank, updateTank } = await import("../src/app/actions");
    const t = await createTank({
      name: "PR Tank", volumeL: 60, waterType: "fresh", plants: [], fish: [], foods: [],
      hasCo2: false, hasHeater: false, hasFilter: true, filterType: null, tankState: "established",
    });
    const tankId = (t as { data?: { id: number } }).data!.id;

    const res = await updateTank(tankId, {
      name: "PR Tank", volumeL: 120, waterType: "fresh", plants: [], fish: [], foods: [],
      hasCo2: false, hasHeater: false, hasFilter: true, filterType: null, tankState: "established",
    });
    expect(res.ok).toBe(true);

    const { getPlanReviewState, markPlanReviewed } = await import("../src/lib/ai/plan-review");
    const st = getPlanReviewState();
    expect(st.state).toBe("pending");
    if (st.state === "pending") expect(st.reason).toBe("tank_change");
    markPlanReviewed();
  });

  it("updateTank WITHOUT master-data change does not trigger", async () => {
    const { createTank, updateTank } = await import("../src/app/actions");
    const t = await createTank({
      name: "PR2", volumeL: 60, waterType: "fresh", plants: [], fish: [], foods: [],
      hasCo2: false, hasHeater: false, hasFilter: true, filterType: null, tankState: "established",
    });
    const tankId = (t as { data?: { id: number } }).data!.id;
    // only rename — no plan-relevant change
    await updateTank(tankId, {
      name: "PR2 renamed", volumeL: 60, waterType: "fresh", plants: [], fish: [], foods: [],
      hasCo2: false, hasHeater: false, hasFilter: true, filterType: null, tankState: "established",
    });
    const { getPlanReviewState } = await import("../src/lib/ai/plan-review");
    expect(getPlanReviewState().state).toBe("idle");
  });

  it("logWaterTest sets pending(water_test)", async () => {
    const { createTank, logWaterTest } = await import("../src/app/actions");
    const t = await createTank({
      name: "PR3", volumeL: 60, waterType: "fresh", plants: [], fish: [], foods: [],
      hasCo2: false, hasHeater: false, hasFilter: true, filterType: null, tankState: "established",
    });
    const tankId = (t as { data?: { id: number } }).data!.id;
    const res = await logWaterTest({ tankId, values: { temp: 25, ph: 7 } });
    expect(res.ok).toBe(true);
    const { getPlanReviewState, markPlanReviewed } = await import("../src/lib/ai/plan-review");
    const st = getPlanReviewState();
    expect(st.state).toBe("pending");
    if (st.state === "pending") expect(st.reason).toBe("water_test");
    markPlanReviewed();
  });
});

describe("plan review — language", () => {
  it("a ready result from another language is dropped instead of shown", async () => {
    const { requestPlanReview, getPlanReviewState, PLAN_REVIEW_KEY } = await import("../src/lib/ai/plan-review");
    const { saveGlobalSettings } = await import("../src/lib/settings");
    const { db } = await import("../src/lib/db");
    const { appSettings } = await import("../src/lib/db/schema");

    saveGlobalSettings({ locale: "de" });
    requestPlanReview("water_test");
    const ready = {
      state: "ready",
      reason: "water_test",
      since: new Date().toISOString(),
      summary: "Nitrat steigt — Wasserwechsel häufiger einplanen.",
      prompts: [{ label: "Intervall anpassen", prompt: "Bitte passe den Wasserwechsel-Plan an." }],
      locale: "de",
    };
    db.insert(appSettings)
      .values({ key: PLAN_REVIEW_KEY, value: ready as never })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: ready as never } })
      .run();
    expect(getPlanReviewState().state).toBe("ready");

    // switching the app to English must not leave German chips in the coach tab
    saveGlobalSettings({ locale: "en" });
    expect(getPlanReviewState().state).toBe("idle");
  });
});
