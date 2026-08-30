/** GET /api/v1/water-parameters — the known parameter keys per water type, so a client knows which keys POST /water-tests accepts. */
import { NextRequest } from "next/server";
import { FRESHWATER_RANGES, SALTWATER_RANGES } from "@/lib/domain/ranges";
import { apiGate } from "@/lib/api/v1-auth";
import { ok } from "@/lib/api/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = apiGate(req);
  if (denied) return denied;
  return ok({ fresh: FRESHWATER_RANGES, salt: SALTWATER_RANGES });
}
