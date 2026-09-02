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
import { failure } from "@/lib/domain/errors";
import { t, actionLabelFor, type Locale } from "@/i18n";
import { getLocale } from "@/lib/settings";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { tanks, schedules } from "@/lib/db/schema";
import { parseProposal, type ProposalChange } from "@/lib/ai/proposal";
import type { ActionResult } from "./actions";

export type ProposalApplyResult = {
  applied: string[]; // human-readable descriptions of what was written
  skipped: { change: string; reason: string }[];
};

/**
 * What was skipped, in the app's language: this text lands in the proposal
 * card the user is looking at, so it goes through the catalogs like any other
 * UI string (the action type itself is localized too).
 */
function describeChange(c: ProposalChange, locale: Locale): string {
  return c.kind === "create"
    ? t("coach.changeCreate", locale, {
        action: actionLabelFor(c.actionType, locale),
        n: c.intervalDays,
        tank: c.tankId,
      })
    : t("coach.changeAdjust", locale, { id: c.scheduleId, n: c.intervalDays });
}

export async function applyProposal(input: unknown): Promise<ActionResult<ProposalApplyResult>> {
  // The proposal re-enters here as UNTRUSTED input from the client — re-parse
  // with the same strict zod schema the stream was validated with.
  const proposal = parseProposal(input);
  if (!proposal) return failure("proposal.invalid", "Invalid proposal (validation failed)");

  const locale = getLocale();
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
          skipped.push({ change: describeChange(c, locale), reason: t("coach.skipTankGone", locale) });
          continue;
        }
        // issue #42: duplicate guard — one plan per standard type per tank
        const { isStandardPlanType } = await import("@/lib/domain/plan-structure");
        if (isStandardPlanType(c.actionType)) {
          const dupe = db
            .select({ id: schedules.id })
            .from(schedules)
            .where(and(eq(schedules.tankId, c.tankId), eq(schedules.actionType, c.actionType), eq(schedules.active, true)))
            .get();
          if (dupe) {
            skipped.push({ change: describeChange(c, locale), reason: t("coach.skipDuplicate", locale, { action: actionLabelFor(c.actionType, locale) }) });
            continue;
          }
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
            detailData: (c.detailData as Record<string, unknown> | undefined) ?? null,
          })
          .run();
        applied.push(describeChange(c, locale));
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
          skipped.push({ change: describeChange(c, locale), reason: t("coach.skipScheduleGone", locale) });
          continue;
        }
        // interval edits clear the snooze — a changed plan invalidates it
        db.update(schedules)
          .set({
            intervalDays: c.intervalDays,
            ...(c.details !== undefined ? { details: c.details } : {}),
            ...(c.detailData !== undefined ? { detailData: c.detailData as Record<string, unknown> } : {}),
            scheduleVersion: sql`${schedules.scheduleVersion} + 1`,
            updatedAt: new Date().toISOString(),
            snoozedUntil: null,
            snoozeSource: null,
          })
          .where(eq(schedules.id, c.scheduleId))
          .run();
        applied.push(describeChange(c, locale));
      }
    } catch (err) {
      console.error("[applyProposal] change failed", err);
      skipped.push({ change: describeChange(c, locale), reason: t("coach.skipWriteFailed", locale) });
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
