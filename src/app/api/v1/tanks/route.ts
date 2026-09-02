/**
 * GET/POST /api/v1/tanks — list tanks / create a tank.
 * v1 REST API (product plan: generic AquaMon control surface for external
 * clients such as an ESPHome display). Bearer-gated via apiToken, same
 * 404-on-bad-token contract as /api/mcp (see src/lib/api/guard.ts).
 */
import { NextRequest } from "next/server";
import { listTanks, createTankCore } from "@/lib/repo";
import { apiGate } from "@/lib/api/v1-auth";
import { serializeTank } from "@/lib/api/serialize";
import { ok, failFor } from "@/lib/api/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = apiGate(req);
  if (denied) return denied;
  return ok({ tanks: listTanks().map(serializeTank) });
}

export async function POST(req: NextRequest) {
  const denied = apiGate(req);
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  const res = createTankCore(body ?? {});
  if (!res.ok) return failFor(res);
  return ok({ id: res.id }, 201);
}
