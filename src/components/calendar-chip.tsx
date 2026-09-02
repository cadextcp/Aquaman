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
import { ScheduleForm, type ScheduleFormTank } from "./schedule-form";
import type { Schedule } from "@/lib/db/schema";
import { useI18n } from "@/i18n/provider";

const STRIPE_COLOR = {
  behind: "var(--warning)",
  due: "var(--due)",
  upcoming: "var(--accent)",
} as const;

export function CalendarChip({
  schedule,
  tanks,
  label,
  variant,
}: {
  schedule: Schedule & { tankName: string };
  /** The tanks the edit popup may point at — see ScheduleCard for why this is required. */
  tanks: ScheduleFormTank[];
  label: string;
  variant: "behind" | "due" | "upcoming";
}) {
  const { t, actionLabel } = useI18n();
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  async function remove() {
    if (!confirm(t("card.deleteConfirm", { action: actionLabel(schedule.actionType), tank: schedule.tankName }))) return;
    setOpen(false);
    await deleteSchedule(schedule.id);
    startTransition(() => router.refresh());
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t("calendarPage.chipEdit", { label })}
        aria-label={t("calendarPage.chipEdit", { label })}
        className="day-stripe"
        style={{ "--stripe": STRIPE_COLOR[variant] } as React.CSSProperties}
      >
        <span />
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t("card.editTitle")}
        actions={<ModalDeleteButton onClick={remove} disabled={pending} />}
      >
        <ScheduleForm tankId={schedule.tankId} tanks={tanks} schedule={schedule} />
      </Modal>
    </>
  );
}
