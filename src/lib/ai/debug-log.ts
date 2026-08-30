/**
 * Raw request/response trace for the Debug page (More → Debug). Separate
 * from `aiCalls` (see schema.ts) — this table is pruned to the most recent
 * MAX_LOGS rows on every insert, since it exists to inspect the last few
 * calls, not to keep permanent history.
 *
 * `request`/`response` are whatever was actually sent to / received from the
 * provider SDK call (never the apiKey — that's a constructor arg, not part
 * of the request body). Called from the three provider call sites: coach
 * streaming (client.ts, shared by the coach route and MCP ask_coach),
 * plan-review-runner.ts, and suggestions.ts.
 */
import { desc, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiCallLogs, type AiCallLog } from "@/lib/db/schema";

const MAX_LOGS = 200;

export function logAiCall(params: {
  purpose: string;
  provider: string;
  model: string;
  request: unknown;
  response: unknown | null;
  error: string | null;
  durationMs: number;
}): void {
  try {
    db.insert(aiCallLogs)
      .values({
        purpose: params.purpose,
        provider: params.provider,
        model: params.model,
        requestJson: JSON.stringify(params.request),
        responseJson: params.response === null ? null : JSON.stringify(params.response),
        error: params.error,
        durationMs: Math.max(0, Math.round(params.durationMs)),
      })
      .run();
    db.run(
      sql`DELETE FROM ai_call_logs WHERE id NOT IN (SELECT id FROM ai_call_logs ORDER BY id DESC LIMIT ${MAX_LOGS})`,
    );
  } catch (err) {
    // debug logging must never break the actual AI call
    console.error("[debug-log] logAiCall failed", err);
  }
}

export function listAiCallLogs(limit = 50): AiCallLog[] {
  return db.select().from(aiCallLogs).orderBy(desc(aiCallLogs.id)).limit(limit).all();
}
