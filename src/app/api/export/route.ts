/**
 * GET /api/export — download the full data snapshot as JSON (PRD §5.9).
 *
 * Same trust boundary as every other page: the app has no auth in v1, this
 * route sits behind the reverse proxy (README security note). GET-only,
 * no-store (a snapshot is point-in-time, never cached by intermediaries),
 * and rate-limited generously only on failures like the other routes —
 * a normal download is a plain 200.
 *
 * appSettings is intentionally NOT in the snapshot (ICS token = secret;
 * range catalogs re-seed on a fresh install). See src/lib/export.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { buildExportSnapshot } from "@/lib/export";
import { APP_VERSION } from "@/lib/version";
import { today } from "@/lib/domain/dates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest): Promise<Response> {
  const snapshot = buildExportSnapshot();
  const filename = `aquaman-export-${today()}.json`;

  return new NextResponse(JSON.stringify(snapshot, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
      "x-aquaman-version": APP_VERSION,
    },
  });
}
