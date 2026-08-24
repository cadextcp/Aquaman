"use client";

/**
 * Pencil button (issue #37): opens the TankForm in a portal dialog right
 * from the tank name row — replaces the hidden "Edit tank" collapse at the
 * bottom of the page. Portal pattern: same as schedule edit dialogs.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
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
        className="rounded-lg shrink-0"
        style={{ width: 36, height: 36, border: "1px solid var(--border)", background: "var(--card)", cursor: "pointer" }}
      >
        ✎
      </button>

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
                <h2 className="text-lg font-semibold">Edit tank</h2>
                <button onClick={() => setOpen(false)} aria-label="Close" className="px-2 py-1 text-lg" style={{ cursor: "pointer" }}>
                  ✕
                </button>
              </div>
              <TankForm tank={tank} />
              <div className="mt-4 text-right">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    startTransition(() => router.refresh());
                  }}
                  className="rounded-lg px-5 py-2.5 text-sm font-medium"
                  style={{ background: "var(--primary)", color: "var(--primary-foreground)", minHeight: 44, cursor: "pointer" }}
                >
                  Done
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
