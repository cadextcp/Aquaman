/**
 * POST /api/mcp — MCP (Model Context Protocol) endpoint, product v1.1
 * (TechDesign §4.6). Lets a remote agent (OpenClaw) read tank state and
 * record care without exposing the whole app.
 *
 * Security model (mirrors the ICS feed, §8b):
 * - The ENTIRE endpoint is bearer-gated (`Authorization: Bearer <mcpToken>`,
 *   stored in appSettings so Settings can show/rotate it).
 * - Invalid/missing token → 404, never 401/403 — don't confirm to a prober
 *   that the endpoint exists. Compared via SHA-256 + timingSafeEqual so the
 *   token's length never leaks via a thrown RangeError.
 * - Failure-only rate limit (30 bad attempts/IP/hour → 429), same limiter
 *   as ICS and the coach route.
 *
 * Transport: @modelcontextprotocol/server's WebStandardStreamableHTTPServer
 * transport in stateless JSON mode (sessionIdGenerator: undefined +
 * enableJsonResponse: true) — every POST is self-contained, which is exactly
 * right for a single-container, single-user appliance. GET (SSE stream) and
 * DELETE (session teardown) are meaningless without sessions → 405.
 */
import { NextRequest, NextResponse } from "next/server";
import { McpServer, WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { createAquamanMcpServer } from "@/lib/mcp/server";
import { getOrCreateMcpToken, safeTokenEqual } from "@/lib/mcp-token";
import { isRateLimited, recordFailure, recordSuccess } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

function bearerToken(req: NextRequest): string | null {
  const h = req.headers.get("authorization");
  if (!h?.startsWith("Bearer ")) return null;
  return h.slice(7).trim() || null;
}

/** Returns a 429/404 response when the request may not proceed, else null. */
function gate(req: NextRequest): NextResponse | null {
  const ip = clientIp(req);
  if (isRateLimited(`mcp:${ip}`)) {
    return new NextResponse(null, { status: 429 });
  }
  const provided = bearerToken(req);
  if (!provided || !safeTokenEqual(provided, getOrCreateMcpToken())) {
    recordFailure(`mcp:${ip}`);
    // 404, never 401/403 — same "no existence confirmation" rule as the ICS feed
    return new NextResponse(null, { status: 404 });
  }
  recordSuccess(`mcp:${ip}`);
  return null;
}

export async function POST(req: NextRequest): Promise<Response> {
  const denied = gate(req);
  if (denied) return denied;

  // Per-request server + transport (stateless): nothing session-shaped lives
  // between requests, so a container restart can never strand a client.
  const server = createAquamanMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    await server.close().catch(() => {});
  }
}

const METHOD_NOT_ALLOWED = () =>
  new NextResponse(null, {
    status: 405,
    headers: { Allow: "POST" },
  });

export async function GET(req: NextRequest): Promise<NextResponse> {
  const denied = gate(req);
  if (denied) return denied;
  return METHOD_NOT_ALLOWED();
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const denied = gate(req);
  if (denied) return denied;
  return METHOD_NOT_ALLOWED();
}
