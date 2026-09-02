/** POST /api/v1/water-tests — record a water test. Same validation as the app (known parameters only, plausible bounds — see validateWaterValues). */
import { NextRequest } from "next/server";
import { logWaterTestCore } from "@/lib/repo";
import { apiGate } from "@/lib/api/v1-auth";
import { ok, failFor } from "@/lib/api/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const denied = apiGate(req);
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  const res = logWaterTestCore(body ?? {});
  if (!res.ok) return failFor(res);
  return ok({ tankId: res.tankId }, 201);
}
