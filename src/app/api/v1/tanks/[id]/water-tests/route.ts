/** GET /api/v1/tanks/{id}/water-tests?days= — water-test history for one tank. */
import { NextRequest } from "next/server";
import { getTank, waterTestsForTank } from "@/lib/repo";
import { apiGate } from "@/lib/api/v1-auth";
import { ok, notFound } from "@/lib/api/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const denied = apiGate(req);
  if (denied) return denied;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return notFound("Tank not found");
  if (!getTank(id)) return notFound("Tank not found");

  const url = new URL(req.url);
  const daysParam = Number(url.searchParams.get("days"));
  const days = Number.isInteger(daysParam) && daysParam > 0 && daysParam <= 3650 ? daysParam : 90;
  return ok({ waterTests: waterTestsForTank(id, days) });
}
