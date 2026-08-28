"use client";

/**
 * Calendar event stripe → opens the schedule editor (issue #31). Renders as
 * a thin full-width colored bar (design: `d.dots`), not a text pill — the
 * day cell is small, so the label lives in the tooltip/aria-label instead.
 * The bar stays 3px; `.day-stripe` pads the button around it so the tap
 * target is ~17px rather than 3px.
 * Receives the plain schedule row (server component) and manages the edit
 * dialog client-side.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteSchedule } from "@/app/actions";
import { Modal, ModalDeleteButton } from "./ui/modal";
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
        className="day-stripe"
        style={{ "--stripe": STRIPE_COLOR[variant] } as React.CSSProperties}
      >
        <span />
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Edit schedule"
        actions={<ModalDeleteButton onClick={remove} disabled={pending} />}
      >
        <ScheduleForm tankId={schedule.tankId} schedule={schedule} />
      </Modal>
    </>
  );
}
