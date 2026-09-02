/**
 * POST /api/v1/actions — the generic event sink (Fütterung is the one
 * exception: it is a daily counter, see /tanks/{id}/feedings). actionType
 * must be one of the standard-events catalog's loggable keys
 * (LOGGABLE_ACTION_TYPES in @/lib/domain/action-types) — anything else,
 * including "feed", is rejected with a 400 listing the valid values.
 */
import { NextRequest } from "next/server";
import { logActionCore } from "@/lib/repo";
import { apiGate } from "@/lib/api/v1-auth";
import { ok, failFor } from "@/lib/api/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const denied = apiGate(req);
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  const res = logActionCore(body ?? {});
  if (!res.ok) return failFor(res);
  return ok({ tankId: res.tankId }, 201);
}
