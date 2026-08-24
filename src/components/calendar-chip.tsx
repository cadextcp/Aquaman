"use client";

/**
 * Calendar event stripe → opens the schedule editor (issue #31). Renders as
 * a thin full-width colored bar (design: `d.dots`), not a text pill — the
 * day cell is small, so the label lives in the tooltip/aria-label instead.
 * Receives the plain schedule row (server component) and manages the edit
 * dialog client-side.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { deleteSchedule } from "@/app/actions";
import { ScheduleForm } from "./schedule-form";
import type { Schedule } from "@/lib/db/schema";

const STRIPE_COLOR = {
  behind: "var(--warning)",
  due: "var(--due)",
  upcoming: "var(--accent)",
} as const;

export function CalendarChip({
  schedule,
  label,
  variant,
}: {
  schedule: Schedule & { tankName: string };
  label: string;
  variant: "behind" | "due" | "upcoming";
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  async function remove() {
    if (!confirm(`Delete "${schedule.actionType.replace(/_/g, " ")}" (${schedule.tankName})?\nLogs and history stay — only the schedule disappears.`)) return;
    setOpen(false);
    await deleteSchedule(schedule.id);
    startTransition(() => router.refresh());
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`${label} — click to edit`}
        aria-label={`${label} — click to edit`}
        className="block w-full rounded-full"
        style={{ height: 3, padding: 0, border: "none", background: STRIPE_COLOR[variant], cursor: "pointer" }}
      />

      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
            style={{ background: "rgba(0,0,0,0.55)" }}
            onClick={() => setOpen(false)}
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
                  <button onClick={() => setOpen(false)} aria-label="Close" className="px-2 py-1 text-lg" style={{ cursor: "pointer" }}>
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
