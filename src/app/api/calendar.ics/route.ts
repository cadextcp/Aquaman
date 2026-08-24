import { NextRequest, NextResponse } from "next/server";
import { listSchedules } from "@/lib/repo";
import { buildIcsFeed } from "@/lib/domain/ics";
import { getOrCreateIcsToken, safeTokenEqual } from "@/lib/ics-token";
import { isRateLimited, recordFailure, recordSuccess } from "@/lib/rate-limit";

/**
 * ICS feed for Google Calendar (TechDesign v1.2 §4.4): GET-only, token in the
 * query string, invalid token → 404 (not 401 — never confirm the feed's
 * existence to an unauthenticated caller), rate-limited.
 */
export const dynamic = "force-dynamic";

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export async function GET(req: NextRequest) {
  const ip = clientIp(req);

  if (isRateLimited(ip)) {
    return new NextResponse(null, { status: 429 });
  }

  const provided = req.nextUrl.searchParams.get("t");
  const expected = getOrCreateIcsToken();

  if (!provided || !safeTokenEqual(provided, expected)) {
    recordFailure(ip);
    // 404, never 401/403 — don't confirm to a prober that the feed exists at all
    return new NextResponse(null, { status: 404 });
  }
  recordSuccess(ip);

  const schedules = listSchedules(); // active only, joined w/ tank name, soft-deleted tanks excluded
  const body = buildIcsFeed(schedules);

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      "Content-Disposition": 'inline; filename="aquaman.ics"',
    },
  });
}
