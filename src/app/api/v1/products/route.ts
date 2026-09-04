/**
 * GET/POST /api/v1/products — the inventory of fertilizers and foods
 * (docs/plan-produkt-lager.md). Install-global, not per tank, so unlike most
 * of this API there is no tank in the path.
 *
 * Bearer-gated via apiGate like every other v1 route; same 404-on-bad-token
 * contract as /api/mcp.
 */
import { NextRequest } from "next/server";
import { listProducts, createProductCore } from "@/lib/repo";
import { apiGate } from "@/lib/api/v1-auth";
import { serializeProduct } from "@/lib/api/serialize";
import { ok, fail, failFor } from "@/lib/api/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = apiGate(req);
  if (denied) return denied;
  const kind = req.nextUrl.searchParams.get("kind");
  // An unknown ?kind is a client bug worth reporting, not something to
  // silently ignore into "here is everything".
  if (kind !== null && kind !== "fertilizer" && kind !== "food") {
    return fail(400, "kind must be 'fertilizer' or 'food'");
  }
  return ok({ products: listProducts(kind ?? undefined).map(serializeProduct) });
}

export async function POST(req: NextRequest) {
  const denied = apiGate(req);
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  const res = createProductCore(body ?? {});
  if (!res.ok) return failFor(res);
  return ok({ id: res.id }, 201);
}
