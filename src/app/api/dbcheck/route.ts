import { NextResponse } from "next/server";
import { getTableName, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";

export const dynamic = "force-dynamic";

/**
 * Dev-only schema smoke test (issue #4): 404 in production builds.
 * /api/health covers the production DB check; this endpoint additionally
 * lists expected vs. present tables for local bring-up debugging.
 */
export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not Found" }, { status: 404 });
  }
  try {
    const tables = Object.values(schema)
      .filter((v) => typeof v === "object" && v !== null && Symbol.for("drizzle:Name") in v)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((v: any) => getTableName(v));

    const rows = db.all<{ name: string }>(sql`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`);
    const present = rows.map((r) => r.name);

    return NextResponse.json({ status: "ok", tables, present });
  } catch {
    return NextResponse.json({ status: "error" }, { status: 500 });
  }
}
