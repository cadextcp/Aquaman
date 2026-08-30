/**
 * GET /api/v1/openapi.json — the v1 REST API's OpenAPI 3.1 spec, generated
 * from the same zod schemas the routes validate with. Ungated, same trust
 * boundary as /api/export and /api/coach (public behind the reverse proxy,
 * see AGENTS.md security section) — this describes the API's shape, not
 * any tank data.
 */
import { NextRequest, NextResponse } from "next/server";
import { buildOpenApiDocument } from "@/lib/api/openapi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const baseUrl = `${new URL(req.url).origin}/api/v1`;
  return NextResponse.json(buildOpenApiDocument(baseUrl), {
    headers: { "cache-control": "no-store" },
  });
}
