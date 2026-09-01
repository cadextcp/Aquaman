/**
 * POST /api/settings/ai/key — set or clear the stored AI API key (issue #40
 * follow-up). Never stored in the DB/exports (see key-store.ts); never
 * echoed back to the client.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { writeStoredApiKey } from "@/lib/ai/key-store";
import { invalidateAiSettingsCache } from "@/lib/ai/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ apiKey: z.string() });

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid key payload" }, { status: 400 });
  }
  try {
    writeStoredApiKey(parsed.data.apiKey);
    invalidateAiSettingsCache();
    return NextResponse.json({ ok: true, cleared: !parsed.data.apiKey.trim() });
  } catch (err) {
    console.error("[settings/ai/key]", err);
    return NextResponse.json({ error: "Could not save key" }, { status: 500 });
  }
}
