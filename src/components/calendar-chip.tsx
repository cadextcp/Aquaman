"use client";

/**
 * Calendar chip → opens the schedule editor (issue #31). Receives the plain
 * schedule row (server component) and manages the edit dialog client-side.
 */

import { useState } from "react";
import { ScheduleForm } from "./schedule-form";
import type { Schedule } from "@/lib/db/schema";

export function CalendarChip({
  schedule,
  label,
  overdue,
}: {
  schedule: Schedule & { tankName: string };
  label: string;
  overdue: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`${label} — click to edit`}
        className="rounded px-1 py-0.5 truncate w-full text-left"
        style={{
          background: overdue ? "var(--warning)" : "var(--primary)",
          color: overdue ? "var(--background)" : "var(--primary-foreground)",
          fontSize: "10px",
          cursor: "pointer",
        }}
      >
        {label}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.5)" }}
          onClick={() => setOpen(false)}
        >
          <div
            className="rounded-xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-5"
            style={{ background: "var(--card)", border: "1px solid var(--border)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Edit schedule</h2>
              <button onClick={() => setOpen(false)} aria-label="Close" className="px-2 py-1 text-lg" style={{ cursor: "pointer" }}>
                ✕
              </button>
            </div>
            <ScheduleForm tankId={schedule.tankId} schedule={schedule} />
          </div>
        </div>
      )}
    </>
  );
}
