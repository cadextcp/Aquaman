/** GET/PATCH/DELETE /api/v1/tanks/{id} — DELETE is a soft delete (tanks.deletedAt), matching the app's own semantics. */
import { NextRequest } from "next/server";
import { getTank, updateTankCore, deleteTankCore } from "@/lib/repo";
import { apiGate } from "@/lib/api/v1-auth";
import { serializeTank } from "@/lib/api/serialize";
import { ok, fail, notFound } from "@/lib/api/respond";

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
  if (id === null) return notFound("Tank not found");
  const tank = getTank(id);
  if (!tank) return notFound("Tank not found");
  return ok(serializeTank(tank));
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const denied = apiGate(req);
  if (denied) return denied;
  const id = parseId((await params).id);
  if (id === null) return notFound("Tank not found");
  // updateTankCore is lenient about a missing tank (matches the Server Action
  // it is shared with — a no-op update, not an error) so the existence check
  // for a proper REST 404 lives here, at the route.
  if (!getTank(id)) return notFound("Tank not found");
  const body = await req.json().catch(() => null);
  const res = updateTankCore(id, body ?? {});
  if (!res.ok) return fail(400, res.error);
  return ok(serializeTank(getTank(id)!));
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const denied = apiGate(req);
  if (denied) return denied;
  const id = parseId((await params).id);
  if (id === null) return notFound("Tank not found");
  const res = deleteTankCore(id);
  if (!res.ok) return fail(400, res.error);
  return new Response(null, { status: 204 });
}
