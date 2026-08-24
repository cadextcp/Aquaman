/**
 * GET /api/coach/suggestions — today's clickable coach suggestions (issue #41).
 * One AI call per local day max (cached in appSettings); 503 when AI is off
 * (the UI hides the chips — core features unaffected). Budget-guarded: 429
 * when the daily limit is reached, ALSO cached-empty so the UI stays quiet.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAiConfig } from "@/lib/ai/config";
import { checkBudget } from "@/lib/ai/cost-guard";
import { getOrCreateDailySuggestions } from "@/lib/ai/suggestions";
import { getDailySuggestions } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest): Promise<NextResponse> {
  // serve from cache without touching the provider or the budget
  const cached = getDailySuggestions();
  if (cached) return NextResponse.json({ items: cached.items, cached: true });

  const config = getAiConfig();
  if (!config) return NextResponse.json({ error: "AI not configured" }, { status: 503 });

  const verdict = checkBudget(config);
  if (!verdict.allowed) {
    // budget done for today — hide quietly instead of alarming the user
    return NextResponse.json({ items: [], cached: true, reason: "budget" });
  }

  const result = await getOrCreateDailySuggestions();
  if (!result) return NextResponse.json({ items: [], cached: true, reason: "unavailable" });
  return NextResponse.json(result);
}
