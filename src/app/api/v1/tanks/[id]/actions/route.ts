/** GET /api/v1/tanks/{id}/actions?type=&limit= — maintenance-log history for one tank. */
import { NextRequest } from "next/server";
import { getTank, recentLogs } from "@/lib/repo";
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
  const type = url.searchParams.get("type");
  const limitParam = Number(url.searchParams.get("limit"));
  const limit = Number.isInteger(limitParam) && limitParam > 0 && limitParam <= 200 ? limitParam : 20;

  const logs = recentLogs(id, limit).filter((l) => !type || l.actionType === type);
  return ok({ actions: logs });
}
