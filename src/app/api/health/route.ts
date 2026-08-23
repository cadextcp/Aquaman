import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    db.get(sql`select 1`);
    return NextResponse.json({ status: "ok", db: "up", time: new Date().toISOString() });
  } catch (err) {
    // Public endpoint: never leak driver internals / file paths (issue #5).
    console.error("[health] db check failed:", err);
    return NextResponse.json({ status: "degraded", db: "down" }, { status: 503 });
  }
}
