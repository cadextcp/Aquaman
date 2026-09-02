/** PATCH/DELETE /api/v1/water-tests/{id} — edit or remove a single water-test row. */
import { NextRequest } from "next/server";
import { updateWaterTestCore, deleteWaterTestCore } from "@/lib/repo";
import { apiGate } from "@/lib/api/v1-auth";
import { ok, notFound, failFor } from "@/lib/api/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const denied = apiGate(req);
  if (denied) return denied;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return notFound("Water test not found");
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const res = updateWaterTestCore({ ...(body ?? {}), id });
  if (!res.ok) return failFor(res);
  return ok({ tankId: res.tankId });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const denied = apiGate(req);
  if (denied) return denied;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return notFound("Water test not found");
  const res = deleteWaterTestCore(id);
  if (!res.ok) return failFor(res, 404);
  return new Response(null, { status: 204 });
}
