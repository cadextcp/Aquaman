/**
 * POST /api/settings/ai — save AI provider settings (issue #40).
 * Same trust boundary as /more itself (behind the reverse proxy; no auth in v1).
 * zod-validated server-side; the API key is never part of this payload.
 */

import { NextRequest, NextResponse } from "next/server";
import { saveAiSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  try {
    const saved = saveAiSettings(body);
    const { invalidateAiSettingsCache } = await import("@/lib/ai/config");
    invalidateAiSettingsCache();
    return NextResponse.json({ ok: true, settings: { ...saved } });
  } catch (err) {
    console.error("[settings/ai]", err);
    return NextResponse.json({ error: "Invalid AI settings" }, { status: 400 });
  }
}
