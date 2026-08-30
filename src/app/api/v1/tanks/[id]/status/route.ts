/**
 * GET /api/v1/tanks/{id}/status — one-request summary for a display screen:
 * the tank plus, per action type, when it was last done and (when a plan
 * exists) how the schedule stands. Generic by construction — the actions
 * map contains every actionType with either a log entry or an active plan,
 * not a fixed list of three; a display just renders whichever keys it cares
 * about (see the aquarium-screen ESPHome device).
 */
import { NextRequest } from "next/server";
import { getTank, listSchedules, lastActionsForTank, lastFeed, todayFeed, waterTestsForTank } from "@/lib/repo";
import { nextDue, missedSlots, dayCount } from "@/lib/domain/scheduler";
import { today as todayStr, isoToLocalDate } from "@/lib/domain/dates";
import { apiGate } from "@/lib/api/v1-auth";
import { serializeTank } from "@/lib/api/serialize";
import { ok, notFound } from "@/lib/api/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

type ActionStatus = {
  lastDoneDay: string | null;
  daysAgo: number | null;
  todayCount?: number;
  scheduleId?: number;
  plannedFor?: string;
  overdueDays?: number;
  missedSlots?: number;
};

export async function GET(req: NextRequest, { params }: Params) {
  const denied = apiGate(req);
  if (denied) return denied;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return notFound("Tank not found");
  const tank = getTank(id);
  if (!tank) return notFound("Tank not found");

  const today = todayStr();
  const actions: Record<string, ActionStatus> = {};

  for (const row of lastActionsForTank(id)) {
    const day = isoToLocalDate(row.lastDoneAt);
    actions[row.actionType] = { lastDoneDay: day, daysAgo: dayCount(day, today) };
  }

  for (const s of listSchedules(id)) {
    const due = nextDue(s);
    const existing = actions[s.actionType];
    actions[s.actionType] = {
      lastDoneDay: existing?.lastDoneDay ?? null,
      daysAgo: existing?.daysAgo ?? null,
      scheduleId: s.id,
      plannedFor: due.plannedFor,
      overdueDays: due.overdueDays,
      missedSlots: missedSlots(s),
    };
  }

  // Feeding is a daily counter (feed_logs), not a maintenance_logs row —
  // sourced separately, same split as the rest of the API (see repo.ts
  // logActionCore's comment on why feed is rejected there).
  const feed = lastFeed(id);
  const feedToday = todayFeed(id, today);
  actions.feed = {
    lastDoneDay: feed?.day ?? null,
    daysAgo: feed ? dayCount(feed.day, today) : null,
    ...(feedToday ? { todayCount: feedToday.timesFed } : {}),
  };

  const tests = waterTestsForTank(id, 365);

  return ok({
    tank: serializeTank(tank),
    actions,
    latestWaterTest: tests[0] ?? null,
  });
}
