/**
 * Plan review state endpoint (proactive coach):
 *   GET  /api/coach/plan-review → current state (idle|pending|thinking|ready)
 *   POST /api/coach/plan-review { action: "start" }  → pending → thinking → ready|idle (AI call)
 *   POST /api/coach/plan-review { action: "reviewed" } → ready → idle
 *
 * Same trust boundary as the app itself (behind the reverse proxy). Budget-guarded
 * like every other AI purpose — on exhaustion the review quietly resolves to idle.
 */

import { NextRequest, NextResponse } from "next/server";
import { getPlanReviewState, runPlanReview, markPlanReviewed } from "@/lib/ai/plan-review";
import { getAiConfig } from "@/lib/ai/config";
import { checkBudget } from "@/lib/ai/cost-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(getPlanReviewState());
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { action?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.action === "reviewed") {
    markPlanReviewed();
    return NextResponse.json({ state: "idle" });
  }

  if (body.action === "start") {
    const state = getPlanReviewState();
    if (state.state !== "pending") {
      return NextResponse.json(state); // nothing to start (already running/ready/idle)
    }
    const config = getAiConfig();
    if (!config) {
      markPlanReviewed(); // AI off → nothing to review, clear the pending flag quietly
      return NextResponse.json({ state: "idle", reason: "ai-off" });
    }
    if (!checkBudget(config).allowed) {
      markPlanReviewed(); // budget exhausted → don't leave a stuck thinking state
      return NextResponse.json({ state: "idle", reason: "budget" });
    }
    const result = await runPlanReview();
    return NextResponse.json(result);
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
