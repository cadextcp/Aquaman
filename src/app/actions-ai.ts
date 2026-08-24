"use server";

/**
 * Approval-gate writes for AI proposals (Phase 4 — TechDesign §4.5).
 *
 * THE rule: the AI NEVER writes. It proposes; the user confirms; this action
 * is the only path a proposal can ever reach the DB through. Every write is
 * re-validated against the LIVE data (tank exists & not deleted, schedule
 * exists & active, interval/mask in bounds) — the AI saw a snapshot, the
 * write must survive a stale snapshot.
 *
 * Per-change semantics (partial application with per-change results):
 * - create → insert schedule (autoReschedule default true, tightGap defaults)
 * - adjust → interval update + scheduleVersion++ (ICS SEQUENCE) + snooze reset
 * Rejected changes are skipped and reported, so one stale id doesn't block
 * the valid rest of a proposal.
 */

import { revalidatePath } from "next/cache";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { tanks, schedules } from "@/lib/db/schema";
import { parseProposal, type ProposalChange } from "@/lib/ai/proposal";
import type { ActionResult } from "./actions";

export type ProposalApplyResult = {
  applied: string[]; // human-readable descriptions of what was written
  skipped: { change: string; reason: string }[];
};

function describeChange(c: ProposalChange): string {
  if (c.kind === "create") return `create ${c.actionType} every ${c.intervalDays}d (tank ${c.tankId})`;
  return `adjust schedule #${c.scheduleId} → every ${c.intervalDays}d`;
}

export async function applyProposal(input: unknown): Promise<ActionResult<ProposalApplyResult>> {
  // The proposal re-enters here as UNTRUSTED input from the client — re-parse
  // with the same strict zod schema the stream was validated with.
  const proposal = parseProposal(input);
  if (!proposal) return { ok: false, error: "Invalid proposal (validation failed)" };

  const applied: string[] = [];
  const skipped: { change: string; reason: string }[] = [];

  for (const c of proposal.changes) {
    try {
      if (c.kind === "create") {
        const tank = db
          .select()
          .from(tanks)
          .where(and(eq(tanks.id, c.tankId), isNull(tanks.deletedAt)))
          .get();
        if (!tank) {
          skipped.push({ change: describeChange(c), reason: "Tank no longer exists" });
          continue;
        }
        db.insert(schedules)
          .values({
            tankId: c.tankId,
            actionType: c.actionType,
            intervalDays: c.intervalDays,
            preferredDays: c.preferredDays,
            autoReschedule: true,
            tightGapPolicy: null,
            tightGapThresholdPct: null,
            details: c.details ?? null,
          })
          .run();
        applied.push(describeChange(c));
      } else {
        // join tanks so soft-deleted tank schedules are treated as gone too
        const s = db
          .select({ id: schedules.id })
          .from(schedules)
          .innerJoin(tanks, eq(schedules.tankId, tanks.id))
          .where(
            and(
              eq(schedules.id, c.scheduleId),
              eq(schedules.active, true),
              isNull(tanks.deletedAt),
            ),
          )
          .get();
        if (!s) {
          skipped.push({ change: describeChange(c), reason: "Schedule no longer exists (or inactive)" });
          continue;
        }
        // interval edits clear the snooze — a changed plan invalidates it
        db.update(schedules)
          .set({
            intervalDays: c.intervalDays,
            ...(c.details !== undefined ? { details: c.details } : {}),
            scheduleVersion: sql`${schedules.scheduleVersion} + 1`,
            updatedAt: new Date().toISOString(),
            snoozedUntil: null,
            snoozeSource: null,
          })
          .where(eq(schedules.id, c.scheduleId))
          .run();
        applied.push(describeChange(c));
      }
    } catch (err) {
      console.error("[applyProposal] change failed", err);
      skipped.push({ change: describeChange(c), reason: "Write failed" });
    }
  }

  if (applied.length > 0) {
    revalidatePath("/");
    revalidatePath("/tanks");
    revalidatePath("/coach");
    revalidatePath("/calendar");
  }

  return { ok: true, data: { applied, skipped } };
}
