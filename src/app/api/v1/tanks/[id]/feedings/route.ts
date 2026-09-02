/**
 * GET/POST /api/v1/tanks/{id}/feedings — feeding is a daily counter
 * (feed_logs, unique per tankId+day, cycling 0→1→2→0), not a timestamped
 * maintenance_logs row — see repo.ts:logActionCore for why /actions
 * deliberately rejects actionType "feed".
 */
import { NextRequest } from "next/server";
import { getTank, feedLogsForTank, adjustFeedCore } from "@/lib/repo";
import { today as todayStr } from "@/lib/domain/dates";
import { feedDayError } from "@/lib/domain/feed-window";
import { apiGate } from "@/lib/api/v1-auth";
import { ok, fail, notFound } from "@/lib/api/respond";

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
  const daysParam = Number(url.searchParams.get("days"));
  const days = Number.isInteger(daysParam) && daysParam > 0 && daysParam <= 365 ? daysParam : 30;
  return ok({ feedings: feedLogsForTank(id, days) });
}

export async function POST(req: NextRequest, { params }: Params) {
  const denied = apiGate(req);
  if (denied) return denied;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return notFound("Tank not found");
  if (!getTank(id)) return notFound("Tank not found");

  const body = (await req.json().catch(() => null)) as { day?: string; delta?: unknown } | null;
  const delta = body?.delta;
  if (delta !== 1 && delta !== -1) return fail(400, "delta must be 1 or -1");
  const day = body?.day ?? todayStr();
  const dayErr = feedDayError(day);
  if (dayErr) return fail(400, dayErr.error);

  const res = adjustFeedCore(id, day, delta);
  return ok({ day, timesFed: res.timesFed });
}
