/**
 * POST /api/v1/actions — the generic event sink (Fütterung is the one
 * exception: it is a daily counter, see /tanks/{id}/feedings). Any
 * actionType string is accepted, not just the built-in ones, so a client
 * can log care AquaMon has no dedicated schedule type for.
 */
import { NextRequest } from "next/server";
import { logActionCore } from "@/lib/repo";
import { apiGate } from "@/lib/api/v1-auth";
import { ok, fail } from "@/lib/api/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const denied = apiGate(req);
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  const res = logActionCore(body ?? {});
  if (!res.ok) return fail(res.error === "Tank not found" ? 404 : 400, res.error);
  return ok({ tankId: res.tankId }, 201);
}
