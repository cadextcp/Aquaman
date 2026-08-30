/**
 * Shared bearer-token gate for token-gated route handlers (v1.1 MCP,
 * v1 REST API). Extracted from the inline gate() that used to live only in
 * api/mcp/route.ts (TechDesign §8b) so a second bearer-gated surface does
 * not reimplement — and risk drifting from — the same security rules:
 *
 * - Invalid/missing token → 404, never 401/403 — don't confirm to a prober
 *   that the endpoint exists.
 * - Token compared via SHA-256 + timingSafeEqual (safeTokenEqual) so a
 *   wrong-length token never throws RangeError into a 500 that leaks length.
 * - Failure-only rate limit (30 bad attempts/IP/hour → 429), shared with
 *   ICS and the coach route via src/lib/rate-limit.ts.
 */
import { NextRequest, NextResponse } from "next/server";
import { isRateLimited, recordFailure, recordSuccess } from "@/lib/rate-limit";

export function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export function bearerToken(req: NextRequest): string | null {
  const h = req.headers.get("authorization");
  if (!h?.startsWith("Bearer ")) return null;
  return h.slice(7).trim() || null;
}

/**
 * Returns a 429/404 response when the request may not proceed, else null.
 * `rateLimitScope` namespaces the failure counter per surface (e.g. "mcp",
 * "api") so exhausting one surface's limit does not lock out the other.
 */
export function bearerGate(
  req: NextRequest,
  rateLimitScope: string,
  currentToken: () => string,
  compare: (provided: string, expected: string) => boolean,
): NextResponse | null {
  const ip = clientIp(req);
  const rlKey = `${rateLimitScope}:${ip}`;
  if (isRateLimited(rlKey)) {
    return new NextResponse(null, { status: 429 });
  }
  const provided = bearerToken(req);
  if (!provided || !compare(provided, currentToken())) {
    recordFailure(rlKey);
    // 404, never 401/403 — same "no existence confirmation" rule as the ICS feed
    return new NextResponse(null, { status: 404 });
  }
  recordSuccess(rlKey);
  return null;
}
