/** POST /api/v1/schedules/{id}/done — mark a plan's current occurrence done (equivalent to tapping "Done" in the app). Body: { note? }. */
import { NextRequest } from "next/server";
import { markScheduleDoneCore } from "@/lib/repo";
import { apiGate } from "@/lib/api/v1-auth";
import { ok, failFor } from "@/lib/api/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const denied = apiGate(req);
  if (denied) return denied;
  const id = Number((await params).id);
  const body = (await req.json().catch(() => null)) as { note?: string } | null;
  const res = markScheduleDoneCore(id, body?.note, "api");
  if (!res.ok) return failFor(res, 404);
  return ok({ tankId: res.tankId });
}
