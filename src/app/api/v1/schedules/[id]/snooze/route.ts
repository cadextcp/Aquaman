/** POST /api/v1/schedules/{id}/snooze — snooze to a later date, taken literally (no weekday shifting). Body: { until: "YYYY-MM-DD" }. */
import { NextRequest } from "next/server";
import { snoozeScheduleCore } from "@/lib/repo";
import { apiGate } from "@/lib/api/v1-auth";
import { ok, fail, failFor } from "@/lib/api/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const denied = apiGate(req);
  if (denied) return denied;
  const id = Number((await params).id);
  const body = (await req.json().catch(() => null)) as { until?: string } | null;
  if (!body?.until) return fail(400, "until (YYYY-MM-DD) is required");
  const res = snoozeScheduleCore(id, body.until);
  if (!res.ok) return failFor(res);
  return ok({ tankId: res.tankId });
}
