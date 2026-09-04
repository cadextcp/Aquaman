/**
 * Integration tests for the MCP endpoint (product v1.1 — TechDesign §4.6):
 * bearer gating (missing/wrong/valid → 404/404/200), method policy, rate
 * limiting, and every tool — reads, writes via the shared cores, validation
 * rejections, the ask_coach AI-off path, and the data boundary (no server
 * paths in tool payloads).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { NextRequest } from "next/server";

const TMP = path.join(tmpdir(), `aquaman-mcp-${Date.now()}`);
process.env.AQUAMAN_DATA_DIR = TMP;
delete process.env.AQUAMAN_AI_API_KEY; // ask_coach must hit the "AI not configured" path

function mcpReq(
  body: unknown,
  opts: { token?: string | null; ip?: string; method?: string } = {},
): NextRequest {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "x-forwarded-for": opts.ip ?? "203.0.113.50",
  };
  if (opts.token !== null) headers["authorization"] = `Bearer ${opts.token ?? "good"}`;
  return new NextRequest(`http://localhost/api/mcp`, {
    method: opts.method ?? "POST",
    headers,
    body: opts.method && opts.method !== "POST" ? undefined : JSON.stringify(body),
  });
}

function rpc(id: number, method: string, params?: unknown) {
  return { jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) };
}

async function callTool(name: string, args: unknown, ip = "203.0.113.51") {
  const { POST } = await import("../src/app/api/mcp/route");
  const res = await POST(mcpReq(rpc(1, "tools/call", { name, arguments: args }), { token: TOKEN, ip }));
  expect(res.status).toBe(200);
  const body = await res.json();
  // the SDK's inputSchema validation can reject args BEFORE our handler runs,
  // with a plain-text (non-JSON) error message — tolerate both shapes
  const rawText = body.result?.content?.[0]?.text ?? "{}";
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawText);
  } catch {
    payload = { error: rawText };
  }
  return {
    isError: body.result?.isError === true,
    payload,
  };
}

let TOKEN = "";
let scheduleId = 0;
let tankId = 0;

beforeAll(async () => {
  mkdirSync(TMP, { recursive: true });
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const { db } = await import("../src/lib/db");
  migrate(db, { migrationsFolder: "./drizzle" });
  const { getOrCreateMcpToken } = await import("../src/lib/mcp-token");
  TOKEN = getOrCreateMcpToken();
  const { tanks, schedules } = await import("../src/lib/db/schema");
  const tank = db
    .insert(tanks)
    .values({ name: "MCP Tank", volumeL: 60, waterType: "fresh" })
    .returning()
    .get();
  tankId = tank.id;
  const s = db
    .insert(schedules)
    .values({ tankId: tank.id, actionType: "water_change", intervalDays: 7, preferredDays: 127 })
    .returning()
    .get();
  scheduleId = s.id;
});

afterAll(async () => {
  const { closeDb } = await import("./helpers");
  closeDb();
  rmSync(TMP, { recursive: true, force: true });
});

beforeEach(async () => {
  const { __resetRateLimiter } = await import("../src/lib/rate-limit");
  __resetRateLimiter();
});

describe("POST /api/mcp — bearer gate", () => {
  it("missing token → 404", async () => {
    const { POST } = await import("../src/app/api/mcp/route");
    const res = await POST(mcpReq(rpc(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } }), { token: null, ip: "198.51.100.60" }));
    expect(res.status).toBe(404);
  });

  it("wrong token → 404 (not 401 — never confirm existence)", async () => {
    const { POST } = await import("../src/app/api/mcp/route");
    const res = await POST(mcpReq(rpc(1, "initialize", {}), { token: "definitely-wrong", ip: "198.51.100.61" }));
    expect(res.status).toBe(404);
  });

  it("valid token + initialize → 200 aquaman serverInfo", async () => {
    const { POST } = await import("../src/app/api/mcp/route");
    const res = await POST(
      mcpReq(rpc(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "openclaw", version: "1" } }), { token: TOKEN }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.serverInfo.name).toBe("aquaman");
    expect(body.result.capabilities.tools).toBeDefined();
  });

  it("garbage body with valid token → not a 404 (gate passed; transport answers)", async () => {
    const { POST } = await import("../src/app/api/mcp/route");
    const req = new NextRequest("http://localhost/api/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", "x-forwarded-for": "198.51.100.62" },
      body: "not json",
    });
    const res = await POST(req);
    // auth already succeeded → MUST NOT be 404 (that's the existence-leak we guard against)
    expect(res.status).not.toBe(404);
  });
});

describe("POST /api/mcp — method policy", () => {
  it("GET with valid token → 405 (no SSE streams without sessions)", async () => {
    const { GET } = await import("../src/app/api/mcp/route");
    const res = await GET(mcpReq(undefined, { token: TOKEN, method: "GET" }));
    expect(res.status).toBe(405);
  });

  it("GET without token → 404", async () => {
    const { GET } = await import("../src/app/api/mcp/route");
    const res = await GET(mcpReq(undefined, { token: null, method: "GET", ip: "198.51.100.63" }));
    expect(res.status).toBe(404);
  });

  it("DELETE with valid token → 405", async () => {
    const { DELETE } = await import("../src/app/api/mcp/route");
    const res = await DELETE(mcpReq(undefined, { token: TOKEN, method: "DELETE" }));
    expect(res.status).toBe(405);
  });
});

describe("POST /api/mcp — rate limit", () => {
  it("30 failed attempts → 429, then success-IP untouched", async () => {
    const { POST } = await import("../src/app/api/mcp/route");
    const ip = "198.51.100.64";
    for (let i = 0; i < 30; i++) {
      const res = await POST(mcpReq(rpc(1, "initialize", {}), { token: "wrong", ip }));
      expect(res.status).toBe(404);
    }
    const limited = await POST(mcpReq(rpc(1, "initialize", {}), { token: "wrong", ip }));
    expect(limited.status).toBe(429);
    // even the CORRECT token is now limited from that IP — the gate is the point
    const blocked = await POST(mcpReq(rpc(1, "initialize", {}), { token: TOKEN, ip }));
    expect(blocked.status).toBe(429);
    // a different IP was never involved
    const other = await POST(mcpReq(rpc(1, "initialize", {}), { token: "wrong", ip: "198.51.100.65" }));
    expect(other.status).toBe(404);
  });
});

describe("MCP tools", () => {
  it("tools/list exposes exactly the TechDesign §4.6 surface (no delete/update)", async () => {
    const { POST } = await import("../src/app/api/mcp/route");
    const res = await POST(mcpReq(rpc(1, "tools/list"), { token: TOKEN }));
    const body = await res.json();
    const names = body.result.tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual([
      "add_water_test",
      "ask_coach",
      "get_pending_maintenance",
      "get_products",
      "get_tanks",
      "get_water_values",
      "log_maintenance",
      "snooze_task",
    ]);
  });

  it("get_tanks returns the tank WITHOUT server paths (data boundary)", async () => {
    const { isError, payload } = await callTool("get_tanks", {});
    expect(isError).toBe(false);
    const tanks = payload.tanks as Array<Record<string, unknown>>;
    expect(tanks.some((t) => t.name === "MCP Tank")).toBe(true);
    expect(JSON.stringify(payload)).not.toContain("photoPath");
    expect(JSON.stringify(payload)).not.toContain(TMP);
  });

  it("add_water_test: implausible value rejected (same bounds as the app)", async () => {
    const { isError, payload } = await callTool("add_water_test", { tankId, values: { no3: 5000 } });
    expect(isError).toBe(true);
    expect(String(payload.error)).toMatch(/plausible/i);
  });

  it("add_water_test: unknown parameter rejected", async () => {
    const { isError, payload } = await callTool("add_water_test", { tankId, values: { unobtainium: 1 } });
    expect(isError).toBe(true);
    expect(String(payload.error)).toMatch(/unknown parameter/i);
  });

  it("add_water_test: unknown tank rejected", async () => {
    const { isError, payload } = await callTool("add_water_test", { tankId: 99999, values: { no3: 10 } });
    expect(isError).toBe(true);
    expect(String(payload.error)).toMatch(/tank not found/i);
  });

  it("add_water_test valid → get_water_values shows it with NH3 evaluation", async () => {
    const saved = await callTool("add_water_test", { tankId, values: { nh4: 0.5, ph: 8.0, temp: 26 } });
    expect(saved.isError).toBe(false);

    const values = await callTool("get_water_values", { tankId });
    expect(values.isError).toBe(false);
    const tanks = values.payload.tanks as Array<Record<string, unknown>>;
    const t = tanks.find((x) => (x.tank as Record<string, unknown>).id === tankId)!;
    const latest = t.latestTest as { values: Record<string, number> };
    expect(latest.values.nh4).toBe(0.5);
    // NH3 is computed from NH4 + pH + temp and evaluated, not just echoed
    const evalKeys = (t.evaluation as Array<{ key: string; status: string }>).map((e) => e.key);
    expect(evalKeys).toContain("nh3");
    const nh3 = (t.evaluation as Array<{ key: string; status: string }>).find((e) => e.key === "nh3")!;
    expect(nh3.status).toBe("critical"); // 0.5 NH4 at pH 8 / 26°C is dangerously toxic
  });

  it("log_maintenance writes the log with source 'mcp' and bumps scheduleVersion", async () => {
    const { db } = await import("../src/lib/db");
    const { schedules, maintenanceLogs } = await import("../src/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    const before = db.select().from(schedules).where(eq(schedules.id, scheduleId)).get()!;

    const res = await callTool("log_maintenance", { scheduleId, note: "did it remotely" });
    expect(res.isError).toBe(false);

    const after = db.select().from(schedules).where(eq(schedules.id, scheduleId)).get()!;
    expect(after.lastDoneAt).toBeTruthy();
    expect(after.scheduleVersion).toBe(before.scheduleVersion + 1);
    expect(after.snoozedUntil).toBeNull();
    const log = db.select().from(maintenanceLogs).where(eq(maintenanceLogs.tankId, tankId)).all().at(-1)!;
    expect(log.source).toBe("mcp");
    expect(log.note).toBe("did it remotely");
  });

  it("snooze_task: past date rejected (same rule as the UI)", async () => {
    const res = await callTool("snooze_task", { scheduleId, until: "2001-01-01" });
    expect(res.isError).toBe(true);
    expect(String(res.payload.error)).toMatch(/past/i);
  });

  it("snooze_task valid future date writes snoozedUntil", async () => {
    const future = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
    const res = await callTool("snooze_task", { scheduleId, until: future });
    expect(res.isError).toBe(false);
    const { db } = await import("../src/lib/db");
    const { schedules } = await import("../src/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    const s = db.select().from(schedules).where(eq(schedules.id, scheduleId)).get()!;
    expect(s.snoozedUntil).toContain(future);
  });

  it("get_pending_maintenance reflects the snooze in plannedFor, keeps originalDueAt honest", async () => {
    const res = await callTool("get_pending_maintenance", { tankId });
    expect(res.isError).toBe(false);
    const tasks = res.payload.tasks as Array<Record<string, unknown>>;
    const task = tasks.find((t) => t.scheduleId === scheduleId)!;
    expect(task.originalDueAt).toBeTruthy();
    // plannedFor (clean plan) is never before originalDueAt (honest backlog)
    expect(String(task.plannedFor) >= String(task.originalDueAt)).toBe(true);
    expect("tightGapHint" in task).toBe(true);
  });

  it("ask_coach without AI key → isError, core stays functional (no provider call)", async () => {
    const res = await callTool("ask_coach", { question: "How is my tank?" });
    expect(res.isError).toBe(true);
    expect(String(res.payload.error)).toMatch(/AI is not configured/i);
  });

  it("ask_coach rejects oversized questions", async () => {
    const res = await callTool("ask_coach", { question: "x".repeat(2001) });
    expect(res.isError).toBe(true);
  });

  it("unknown tool → transport-level error, not a crash", async () => {
    const { POST } = await import("../src/app/api/mcp/route");
    const res = await POST(mcpReq(rpc(1, "tools/call", { name: "drop_tables", arguments: {} }), { token: TOKEN }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result?.isError === true || body.error !== undefined).toBe(true);
  });
});
