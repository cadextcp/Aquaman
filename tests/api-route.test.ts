/**
 * v1 REST API — bearer gate + rate-limit scoping (mirrors tests/mcp-route.test.ts
 * for /api/mcp, but proves the apiToken/mcpToken and "api:"/"mcp:" rate-limit
 * scopes are independent — rotating or rate-limiting one must not affect the
 * other).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { NextRequest } from "next/server";

const TMP = path.join(tmpdir(), `aquaman-api-route-${Date.now()}`);
process.env.AQUAMAN_DATA_DIR = TMP;

function apiReq(url: string, opts: { token?: string | null; ip?: string; method?: string; body?: unknown } = {}): NextRequest {
  const headers: Record<string, string> = { "x-forwarded-for": opts.ip ?? "203.0.113.80" };
  if (opts.token !== null) headers["authorization"] = `Bearer ${opts.token ?? "good"}`;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(url, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

let API_TOKEN = "";
let MCP_TOKEN = "";

beforeAll(async () => {
  mkdirSync(TMP, { recursive: true });
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const { db } = await import("../src/lib/db");
  migrate(db, { migrationsFolder: "./drizzle" });
  const { getOrCreateApiToken } = await import("../src/lib/api-token");
  const { getOrCreateMcpToken } = await import("../src/lib/mcp-token");
  API_TOKEN = getOrCreateApiToken();
  MCP_TOKEN = getOrCreateMcpToken();
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

describe("GET /api/v1/tanks — bearer gate", () => {
  it("missing token → 404", async () => {
    const { GET } = await import("../src/app/api/v1/tanks/route");
    const res = await GET(apiReq("http://localhost/api/v1/tanks", { token: null, ip: "198.51.100.80" }));
    expect(res.status).toBe(404);
  });

  it("wrong token → 404 (not 401)", async () => {
    const { GET } = await import("../src/app/api/v1/tanks/route");
    const res = await GET(apiReq("http://localhost/api/v1/tanks", { token: "wrong", ip: "198.51.100.81" }));
    expect(res.status).toBe(404);
  });

  it("the MCP token does NOT work here — the two surfaces have separate tokens", async () => {
    const { GET } = await import("../src/app/api/v1/tanks/route");
    const res = await GET(apiReq("http://localhost/api/v1/tanks", { token: MCP_TOKEN, ip: "198.51.100.82" }));
    expect(res.status).toBe(404);
  });

  it("valid apiToken → 200", async () => {
    const { GET } = await import("../src/app/api/v1/tanks/route");
    const res = await GET(apiReq("http://localhost/api/v1/tanks", { token: API_TOKEN, ip: "198.51.100.83" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.tanks)).toBe(true);
  });
});

describe("GET /api/v1/tanks — rate limit is scoped separately from /api/mcp", () => {
  it("30 failed api: attempts → 429, but the mcp: scope on the same IP is untouched", async () => {
    const { GET } = await import("../src/app/api/v1/tanks/route");
    const ip = "198.51.100.84";
    for (let i = 0; i < 30; i++) {
      const res = await GET(apiReq("http://localhost/api/v1/tanks", { token: "wrong", ip }));
      expect(res.status).toBe(404);
    }
    const limited = await GET(apiReq("http://localhost/api/v1/tanks", { token: "wrong", ip }));
    expect(limited.status).toBe(429);
    // even the correct apiToken is now limited from that IP
    const blocked = await GET(apiReq("http://localhost/api/v1/tanks", { token: API_TOKEN, ip }));
    expect(blocked.status).toBe(429);

    // the MCP route on the SAME ip is a different rate-limit key ("mcp:") —
    // still open
    const { POST: mcpPost } = await import("../src/app/api/mcp/route");
    const mcpRes = await mcpPost(
      new NextRequest("http://localhost/api/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${MCP_TOKEN}`,
          "x-forwarded-for": ip,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } }),
      }),
    );
    expect(mcpRes.status).toBe(200);
  });
});
