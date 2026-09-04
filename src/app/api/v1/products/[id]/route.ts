/** GET/PATCH/DELETE /api/v1/products/{id} — one inventory product. */
import { NextRequest } from "next/server";
import { getProduct, updateProductCore, deleteProductCore } from "@/lib/repo";
import { apiGate } from "@/lib/api/v1-auth";
import { serializeProduct } from "@/lib/api/serialize";
import { ok, notFound, failFor } from "@/lib/api/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const denied = apiGate(req);
  if (denied) return denied;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return notFound("Product not found");
  const product = getProduct(id);
  if (!product) return notFound("Product not found");
  return ok(serializeProduct(product));
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const denied = apiGate(req);
  if (denied) return denied;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return notFound("Product not found");
  const body = await req.json().catch(() => null);
  const res = updateProductCore(id, body ?? {});
  if (!res.ok) return failFor(res);
  // `renamedPlans` is not bookkeeping noise: a rename rewrites food keys in
  // active plans, and a client that just renamed something should be able to
  // tell whether it touched anything.
  return ok({ id, renamedPlans: res.renamedPlans });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const denied = apiGate(req);
  if (denied) return denied;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return notFound("Product not found");
  const res = deleteProductCore(id);
  if (!res.ok) return failFor(res, 404);
  return new Response(null, { status: 204 });
}
