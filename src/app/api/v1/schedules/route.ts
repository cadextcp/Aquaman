/** GET/POST /api/v1/schedules — list active plans (optionally ?tankId=) / create a plan. */
import { NextRequest } from "next/server";
import { listSchedules, createScheduleCore } from "@/lib/repo";
import { apiGate } from "@/lib/api/v1-auth";
import { serializeSchedule } from "@/lib/api/serialize";
import { ok, failFor } from "@/lib/api/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = apiGate(req);
  if (denied) return denied;
  const url = new URL(req.url);
  const tankIdParam = Number(url.searchParams.get("tankId"));
  const tankId = Number.isInteger(tankIdParam) && tankIdParam > 0 ? tankIdParam : undefined;
  return ok({ schedules: listSchedules(tankId).map(serializeSchedule) });
}

export async function POST(req: NextRequest) {
  const denied = apiGate(req);
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  const res = createScheduleCore(body ?? {});
  if (!res.ok) return failFor(res);
  return ok({ id: res.id }, 201);
}
