/**
 * POST /api/feeding-plan/draft — the "suggest a feeding plan" button
 * (docs/plan-fuetterungsplan.md).
 *
 * Request:  { tankId: number }
 * Response: { ok: true, plan } | { ok: false, error, code }
 *
 * Like /api/inventory/import this route NEVER writes: the draft goes into the
 * editor and the user presses Save (a Server Action) — the manual save is the
 * approval gate, there is no second one. Not token-gated either, same reverse
 * -proxy posture as the coach; the per-IP cap below plus the shared two-tier
 * AI budget are what stop it becoming a cost spigot.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { draftFeedingPlan } from "@/lib/ai/feeding-plan-draft";
import { hitLimit } from "@/lib/rate-limit";
import { getLocale } from "@/lib/settings";
import type { ErrorCode } from "@/lib/domain/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Drafts per IP per hour — same ceiling the product import uses. */
const MAX_DRAFTS_PER_HOUR = 10;

const bodySchema = z.object({ tankId: z.number().int().positive() });

function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

function failure(code: ErrorCode, status: number, error: string) {
  return NextResponse.json({ ok: false, error, code }, { status });
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  if (hitLimit(`feedingPlanDraft:${ip}`, MAX_DRAFTS_PER_HOUR)) {
    return failure("feedingPlan.rateLimited", 429, "Too many draft requests, try again later");
  }

  const parsedBody = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsedBody.success) {
    return failure("feedingPlan.tankNotFound", 400, "tankId is required");
  }

  const result = await draftFeedingPlan({ tankId: parsedBody.data.tankId, locale: getLocale() });

  if (!result.ok) {
    const status =
      result.code === "feedingPlan.limitReached" || result.code === "feedingPlan.rateLimited"
        ? 429
        : result.code === "feedingPlan.aiOffline"
          ? 503
          : result.code === "feedingPlan.tankNotFound"
            ? 404
            : 422;
    return failure(result.code, status, `Could not draft a feeding plan (${result.code})`);
  }

  return NextResponse.json({ ok: true, plan: result.plan });
}
