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
import { createPortal } from "react-dom";
import { markDone, snooze, undoLastDone, deleteSchedule } from "@/app/actions";
import { ScheduleForm } from "./schedule-form";
import type { Schedule } from "@/lib/db/schema";

export type ScheduleCardData = Schedule & {
  tankName: string;
  due: { originalDueAt: string; plannedFor: string; overdueDays: number };
  today: string; // YYYY-MM-DD
};

/** actionType → Phosphor icon + rail color (from the design's TASKS list) */
const ACTION_ICON: Record<string, { icon: string; color: string }> = {
  water_change: { icon: "drop-half", color: "var(--due)" },
  water_test: { icon: "eyedropper", color: "var(--accent)" },
  fertilize: { icon: "flask", color: "var(--warning)" },
  filter_change: { icon: "funnel", color: "var(--accent)" },
  filter_clean: { icon: "funnel", color: "var(--accent)" },
  glass_clean: { icon: "sparkle", color: "var(--accent)" },
  plant_trim: { icon: "leaf", color: "var(--success)" },
};
function actionVisual(actionType: string) {
  return ACTION_ICON[actionType] ?? { icon: "check", color: "var(--secondary-foreground)" };
}

function daysUntil(dateStr: string, today: string): number {
  const [y1, m1, d1] = today.split("-").map(Number);
  const [y2, m2, d2] = dateStr.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

export function ScheduleCard({ schedule, adherence = null }: { schedule: ScheduleCardData; adherence?: number | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);
  const [justDone, setJustDone] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);

  const { due, today } = schedule;
  const dueTodayOrOverdue = due.plannedFor <= today;
  const daysIn = daysUntil(due.plannedFor, today);
  const ended = schedule.endsOn && schedule.endsOn < today;

  async function done() {
    await markDone(schedule.id);
    setJustDone(true);
    startTransition(() => router.refresh());
  }

  async function undo() {
    await undoLastDone(schedule.id);
    setJustDone(false);
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
    if (!confirm(`Delete "${schedule.actionType.replace(/_/g, " ")}" (${schedule.tankName})?\nLogs and history stay — only the schedule disappears.`)) return;
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
          background: justDone ? "var(--success-soft)" : "rgba(233,233,237,0.05)",
          boxShadow: `inset 0 0 0 1px ${justDone ? "rgba(74,222,128,0.22)" : "rgba(233,233,237,0.08)"}`,
          opacity: justDone ? 0.85 : 1,
        }}
        title="Click to view & edit this schedule"
      >
        {/* icon rail */}
        <span
          aria-hidden
          className={`ph ph-${actionVisual(schedule.actionType).icon} text-xl shrink-0 self-center`}
          style={{ color: justDone ? "var(--success)" : actionVisual(schedule.actionType).color }}
        />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="font-medium truncate" style={{ textDecoration: justDone ? "line-through" : "none" }}>
              {schedule.actionType.replace(/_/g, " ")}
              <span className="text-sm font-normal" style={{ color: "var(--muted-foreground)" }}>
                {" "}· every {schedule.intervalDays}d
                {schedule.endsOn ? ` · until ${schedule.endsOn}` : ""}
              </span>
              {adherence !== null && (
                <span
                  className="text-xs tnum ml-1.5"
                  style={{ color: adherence >= 80 ? "var(--success)" : "var(--warning)" }}
                  title="share of planned occurrences closed on time (30 d)"
                >
                  · {adherence}% on time
                </span>
              )}
            </div>
            {schedule.details && (
              <div className="text-sm mt-0.5" style={{ color: "var(--accent)" }}>
                {schedule.details}
              </div>
            )}
            <div className="text-sm mt-1" style={{ color: "var(--muted-foreground)" }}>
              {due.overdueDays > 0 ? (
                <span style={{ color: "var(--warning)" }}>behind {due.overdueDays}d</span>
              ) : dueTodayOrOverdue ? (
                <span style={{ color: "var(--accent)" }}>due today</span>
              ) : (
                <>due in {daysIn} {daysIn === 1 ? "day" : "days"} · <strong>{due.plannedFor}</strong></>
              )}
              {due.overdueDays > 0 && <> · planned <strong>{due.plannedFor}</strong></>}
            </div>
          </div>

          {/* state-dependent controls — click must NOT open the editor */}
          <div className="flex flex-col items-end gap-1" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            <button
              onClick={remove}
              disabled={pending}
              aria-label="Delete schedule"
              title="Delete schedule"
              className="rounded-md text-sm"
              style={{ width: 30, height: 28, color: "var(--destructive)", border: "1px solid var(--border)", background: "var(--card)", cursor: "pointer" }}
            >
              🗑
            </button>
            {justDone ? (
              <button
                onClick={undo}
                disabled={pending}
                className="rounded-lg px-3 py-2 text-xs font-medium whitespace-nowrap"
                style={{ border: "1px solid var(--border)", minHeight: 36, cursor: "pointer" }}
              >
                ↩ Undo done
              </button>
            ) : dueTodayOrOverdue ? (
              /* primary checkbox-style control for due/overdue */
              <button
                onClick={done}
                disabled={pending}
                aria-label={`Mark ${schedule.actionType} done`}
                className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium whitespace-nowrap"
                style={{ background: "var(--primary)", color: "var(--primary-foreground)", minHeight: 40, cursor: "pointer" }}
              >
                <span aria-hidden className="text-base">☐</span> Done
              </button>
            ) : (
              /* future: neutral status, secondary actions */
              <div className="flex items-center gap-1.5">
                <button
                  onClick={done}
                  disabled={pending}
                  className="rounded-lg px-2.5 py-1.5 text-xs"
                  style={{ border: "1px solid var(--border)", color: "var(--muted-foreground)", minHeight: 32, cursor: "pointer" }}
                  title="Mark as done early"
                >
                  done early
                </button>
                <div className="relative">
                  <button
                    onClick={() => setSnoozeOpen((o) => !o)}
                    disabled={pending}
                    className="rounded-lg px-2.5 py-1.5 text-xs"
                    style={{ border: "1px solid var(--border)", color: "var(--muted-foreground)", minHeight: 32, cursor: "pointer" }}
                  >
                    later
                  </button>
                  {snoozeOpen && (
                    <div
                      className="absolute right-0 top-full mt-1 rounded-lg z-10 py-1 shadow-lg"
                      style={{ background: "var(--card)", border: "1px solid var(--border)" }}
                    >
                      {[1, 3, 7].map((d) => (
                        <button
                          key={d}
                          onClick={() => snoozeBy(d)}
                          className="block w-full text-left px-4 py-2 text-sm hover:opacity-80"
                        >
                          +{d} {d === 1 ? "day" : "days"}
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

      {/* edit dialog — PORTAL: the calendar grid fades padding days via
          opacity, and opacity creates a stacking context that a plain
          position:fixed child cannot escape → the dialog inherited the
          translucency. Rendering into document.body fixes it. */}
      {editOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
            style={{ background: "rgba(0,0,0,0.55)" }}
            onClick={() => setEditOpen(false)}
          >
            <div
              className="rounded-xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-5"
              style={{ background: "var(--card)", border: "1px solid var(--border)" }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Edit schedule</h2>
                <div className="flex items-center gap-1">
                  <button onClick={remove} disabled={pending} aria-label="Delete schedule" title="Delete schedule"
                    className="rounded-lg px-2.5 py-1.5"
                    style={{ color: "var(--destructive)", cursor: "pointer", border: "1px solid var(--border)" }}>
                    🗑
                  </button>
                  <button onClick={() => setEditOpen(false)} aria-label="Close"
                    className="rounded-lg px-2 py-1 text-lg" style={{ cursor: "pointer" }}>
                    ✕
                  </button>
                </div>
              </div>
              <ScheduleForm tankId={schedule.tankId} schedule={schedule} />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
