"use client";

/**
 * Pencil button (issue #37): opens the TankForm in a dialog right from the
 * tank name row — replaces the hidden "Edit tank" collapse at the bottom of
 * the page. Uses the shared Modal, same as the schedule editors.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "./ui/modal";
import { TankForm } from "./tank-form";
import type { Tank } from "@/lib/db/schema";

export function EditTankButton({ tank }: { tank: Tank }) {
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();
  const router = useRouter();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Edit ${tank.name}`}
        title="Edit tank"
        className="icon-btn icon-btn-sm"
      >
        <i aria-hidden className="ph ph-pencil-simple text-base" />
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Edit tank">
        <TankForm tank={tank} />
        <div className="mt-4 text-right">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              startTransition(() => router.refresh());
            }}
            className="btn-outline rounded-lg px-5 py-2.5 text-sm font-medium"
            style={{ minHeight: 44 }}
          >
            Done
          </button>
        </div>
      </Modal>
    </>
  );
}
