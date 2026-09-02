"use client";

/**
 * Clickable schedule card (issues #31/#33/#34):
 * - whole card opens the edit dialog (pre-filled ScheduleForm)
 * - state-dependent controls: due today/overdue → checkbox Done; future →
 *   "due in X d" + secondary early-done/snooze (never a misleading "Done")
 * - Undo right after marking done (undoLastDone)
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markDone, snooze, undoLastDone, deleteSchedule } from "@/app/actions";
import { Modal, ModalDeleteButton } from "./ui/modal";
import { HelpDot } from "./ui/help";
import { ScheduleForm, type ScheduleFormTank } from "./schedule-form";
import type { Schedule } from "@/lib/db/schema";
import { actionTypeDef } from "@/lib/domain/action-types";
import { useI18n } from "@/i18n/provider";

export type ScheduleCardData = Schedule & {
  tankName: string;
  due: { originalDueAt: string; plannedFor: string; overdueDays: number };
  today: string; // YYYY-MM-DD
};

/** actionType → Phosphor icon color, per rail (from the design's TASKS list) — icon name itself comes from the catalog. */
const ACTION_COLOR: Record<string, string> = {
  water_change: "var(--due)",
  water_top_up: "var(--due)",
  water_test: "var(--accent)",
  fertilize: "var(--warning)",
  substrate_vacuum: "var(--accent)",
  filter_change: "var(--accent)",
  filter_clean: "var(--accent)",
  glass_clean: "var(--accent)",
  plant_trim: "var(--success)",
};
function actionVisual(actionType: string) {
  const icon = actionTypeDef(actionType)?.icon ?? "check";
  return { icon, color: ACTION_COLOR[actionType] ?? "var(--secondary-foreground)" };
}

function daysUntil(dateStr: string, today: string): number {
  const [y1, m1, d1] = today.split("-").map(Number);
  const [y2, m2, d2] = dateStr.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

export function ScheduleCard({
  schedule,
  tanks,
  adherence = null,
  doneToday = false,
  showTankName = false,
}: {
  schedule: ScheduleCardData;
  /**
   * The tanks the edit popup may point at — its selector options, and the
   * volume/foods the structured detail editor computes with. Required, so a
   * page cannot hand the dialog an empty list by omission.
   */
  tanks: ScheduleFormTank[];
  adherence?: number | null;
  /**
   * The schedule was closed today (derived from lastDoneAt by the page).
   * This — not the local flag below — is what keeps the Undo control on
   * screen: markDone revalidates "/", which re-renders the page and moves the
   * card to a different section, unmounting this component and discarding any
   * local state with it.
   */
  doneToday?: boolean;
  /** Show which tank this belongs to (dashboard "All tanks" view) — redundant on a single-tank page, so opt-in. */
  showTankName?: boolean;
}) {
  const router = useRouter();
  const { t, plural, actionLabel, errorText } = useI18n();
  const [pending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);
  // optimistic flag, only bridging the gap until the revalidation lands
  const [justDone, setJustDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const showDone = doneToday || justDone;

  const { due, today } = schedule;
  const dueTodayOrOverdue = due.plannedFor <= today;
  const daysIn = daysUntil(due.plannedFor, today);
  const ended = schedule.endsOn && schedule.endsOn < today;

  async function done() {
    // a rejected write must not leave the card claiming it is done
    const res = await markDone(schedule.id);
    setError(res.ok ? null : errorText(res));
    setJustDone(res.ok);
    startTransition(() => router.refresh());
  }

  async function undo() {
    const res = await undoLastDone(schedule.id);
    setError(res.ok ? null : errorText(res));
    if (res.ok) setJustDone(false);
    startTransition(() => router.refresh());
  }

  async function snoozeBy(days: number) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    await snooze(schedule.id, d.toISOString().slice(0, 10));
    setSnoozeOpen(false);
    startTransition(() => router.refresh());
  }

  async function remove() {
    if (!confirm(t("card.deleteConfirm", { action: actionLabel(schedule.actionType), tank: schedule.tankName }))) return;
    setEditOpen(false);
    await deleteSchedule(schedule.id);
    startTransition(() => router.refresh());
  }

  if (ended) return null; // issue #31: ended schedules are invisible

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setEditOpen(true)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setEditOpen(true)}
        className="rounded-xl p-3.5 cursor-pointer flex gap-3 items-stretch anim-tickin"
        style={{
          background: showDone ? "var(--success-soft)" : "var(--surface)",
          boxShadow: `inset 0 0 0 1px ${showDone ? "var(--success-edge)" : "var(--surface-edge)"}`,
          opacity: showDone ? 0.85 : 1,
        }}
        title={t("card.clickToEdit")}
      >
        {/* icon rail */}
        <span
          aria-hidden
          className={`ph ph-${actionVisual(schedule.actionType).icon} text-xl shrink-0 self-start mt-0.5 sm:mt-0 sm:self-center`}
          style={{ color: showDone ? "var(--success)" : actionVisual(schedule.actionType).color }}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <div className="min-w-0 flex-1">
            {showTankName && (
              <div className="text-xs font-medium mb-0.5 truncate" style={{ color: "var(--accent)" }}>
                {schedule.tankName}
              </div>
            )}
            <div className="font-medium" style={{ textDecoration: showDone ? "line-through" : "none" }}>
              {actionLabel(schedule.actionType)}
              <span className="text-sm font-normal" style={{ color: "var(--muted-foreground)" }}>
                {" "}· {t("schedule.every", { n: schedule.intervalDays })}
                {schedule.endsOn ? ` ${t("card.until", { date: schedule.endsOn })}` : ""}
              </span>
              {adherence !== null && (
                <span
                  className="text-xs tnum ml-1.5"
                  style={{ color: adherence >= 80 ? "var(--success)" : "var(--warning)" }}
                >
                  {t("card.onTimePct", { n: adherence })}
                </span>
              )}
              {adherence !== null && <HelpDot id="onTime" />}
            </div>
            {schedule.details && (
              <div className="text-sm mt-0.5" style={{ color: "var(--accent)" }}>
                {schedule.details}
              </div>
            )}
            <div className="text-sm mt-1" style={{ color: "var(--muted-foreground)" }}>
              {showDone ? (
                <>
                  <span style={{ color: "var(--success)" }}>{t("card.doneToday")}</span> · {t("card.next")}{" "}
                  <strong>{due.plannedFor}</strong>
                </>
              ) : due.overdueDays > 0 ? (
                <span style={{ color: "var(--warning)" }}>{t("schedule.behind", { n: due.overdueDays })}</span>
              ) : dueTodayOrOverdue ? (
                <span style={{ color: "var(--accent)" }}>{t("card.dueToday")}</span>
              ) : (
                <>{plural("card.dueInDays", daysIn)} · <strong>{due.plannedFor}</strong></>
              )}
              {!showDone && due.overdueDays > 0 && (
                <>
                  {" "}· {t("schedule.planned")} <strong>{due.plannedFor}</strong>
                  <HelpDot id="plannedDate" />
                </>
              )}
            </div>
            {error && (
              <p role="alert" className="text-sm mt-1" style={{ color: "var(--destructive)" }}>
                {error}
              </p>
            )}
          </div>

          {/* state-dependent controls, all on ONE row — click must NOT open the editor */}
          <div
            className="flex shrink-0 items-center justify-end gap-1.5"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <button
              onClick={remove}
              disabled={pending}
              aria-label={t("card.deleteSchedule")}
              title={t("card.deleteSchedule")}
              className="icon-btn icon-btn-sm icon-btn-danger mr-0.5"
            >
              <i aria-hidden className="ph ph-trash text-base" />
            </button>
            {showDone ? (
              <button
                onClick={undo}
                disabled={pending}
                className="btn-ghost inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium whitespace-nowrap"
                style={{ minHeight: 36 }}
              >
                <i aria-hidden className="ph ph-arrow-counter-clockwise text-sm" /> {t("card.undoDone")}
              </button>
            ) : dueTodayOrOverdue ? (
              /* primary checkbox-style control for due/overdue */
              <button
                onClick={done}
                disabled={pending}
                aria-label={t("card.markDone", { action: actionLabel(schedule.actionType) })}
                className="btn-outline flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium whitespace-nowrap"
                style={{ minHeight: 40 }}
              >
                <i aria-hidden className="ph ph-square text-base" /> {t("common.done")}
              </button>
            ) : (
              /* future: neutral status, secondary actions */
              <div className="flex items-center gap-1.5">
                <HelpDot id="earlyLater" />
                <button
                  onClick={done}
                  disabled={pending}
                  className="btn-ghost rounded-lg px-2.5 py-1.5 text-xs"
                  style={{ minHeight: 32 }}
                >
                  {t("card.doneEarly")}
                </button>
                <div className="relative">
                  <button
                    onClick={() => setSnoozeOpen((o) => !o)}
                    disabled={pending}
                    className="btn-ghost rounded-lg px-2.5 py-1.5 text-xs"
                    style={{ minHeight: 32 }}
                  >
                    {t("card.later")}
                  </button>
                  {snoozeOpen && (
                    <div
                      className="panel-card absolute right-0 top-full mt-1 rounded-lg z-10 py-1 shadow-lg"
                    >
                      {[1, 3, 7].map((d) => (
                        <button
                          key={d}
                          onClick={() => snoozeBy(d)}
                          className="block w-full text-left px-4 py-2 text-sm hover:opacity-80"
                        >
                          {plural("card.snoozeDays", d)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title={t("card.editTitle")}
        actions={<ModalDeleteButton onClick={remove} disabled={pending} />}
      >
        <ScheduleForm tankId={schedule.tankId} tanks={tanks} schedule={schedule} />
      </Modal>
    </>
  );
}
