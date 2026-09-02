/**
 * GET /api/v1/tasks?tankId= — open maintenance across active plans, using
 * the same projection as the dashboard/MCP (nextDue/missedSlots/
 * catchUpWeight — one implementation, see src/lib/mcp/tools.ts).
 */
import { NextRequest } from "next/server";
import { getPendingMaintenance } from "@/lib/mcp/tools";
import { apiGate } from "@/lib/api/v1-auth";
import { ok, fail } from "@/lib/api/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = apiGate(req);
  if (denied) return denied;
  const url = new URL(req.url);
  const tankIdParam = Number(url.searchParams.get("tankId"));
  const tankId = Number.isInteger(tankIdParam) && tankIdParam > 0 ? tankIdParam : undefined;
  const res = getPendingMaintenance({ tankId });
  // MCP tool outcomes carry no failure code (machine-facing surface only)
  if (!res.ok) return fail(400, res.error);
  return ok(res.payload);
}
