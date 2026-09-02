/** GET/PATCH/DELETE /api/v1/schedules/{id} — DELETE is a hard delete (nothing references schedules.id; history lives in maintenance_logs by tankId+actionType). */
import { NextRequest } from "next/server";
import { getSchedule, updateScheduleCore, deleteScheduleCore } from "@/lib/repo";
import { apiGate } from "@/lib/api/v1-auth";
import { serializeSchedule } from "@/lib/api/serialize";
import { ok, notFound, failFor } from "@/lib/api/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function GET(req: NextRequest, { params }: Params) {
  const denied = apiGate(req);
  if (denied) return denied;
  const id = parseId((await params).id);
  if (id === null) return notFound("Schedule not found");
  const s = getSchedule(id);
  if (!s) return notFound("Schedule not found");
  return ok(serializeSchedule(s));
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const denied = apiGate(req);
  if (denied) return denied;
  const id = parseId((await params).id);
  if (id === null) return notFound("Schedule not found");
  if (!getSchedule(id)) return notFound("Schedule not found");
  const body = await req.json().catch(() => null);
  const res = updateScheduleCore(id, body ?? {});
  if (!res.ok) return failFor(res);
  return ok(serializeSchedule(getSchedule(id)!));
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const denied = apiGate(req);
  if (denied) return denied;
  const id = parseId((await params).id);
  if (id === null) return notFound("Schedule not found");
  const res = deleteScheduleCore(id);
  if (!res.ok) return failFor(res, 404);
  return new Response(null, { status: 204 });
}
