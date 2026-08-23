import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // DB ping — proves SQLite file is mounted & reachable
    db.get(sql`select 1`);
    return NextResponse.json({ status: "ok", db: "up", time: new Date().toISOString() });
  } catch (err) {
    return NextResponse.json(
      { status: "degraded", db: "down", error: String(err) },
      { status: 503 },
    );
  }
}
