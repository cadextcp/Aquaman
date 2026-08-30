/** POST /api/v1/schedules/{id}/undo — undo the most recent "done" for this plan (restores the previous lastDoneAt). */
import { NextRequest } from "next/server";
import { undoLastDoneCore } from "@/lib/repo";
import { apiGate } from "@/lib/api/v1-auth";
import { ok, fail } from "@/lib/api/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const denied = apiGate(req);
  if (denied) return denied;
  const id = Number((await params).id);
  const res = undoLastDoneCore(id);
  if (!res.ok) return fail(res.error === "Schedule not found" ? 404 : 400, res.error);
  return ok({ tankId: res.tankId });
}
