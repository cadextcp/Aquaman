"use client";

/**
 * One dialog for the whole app. Replaces three verbatim copies of the same
 * scrim + sheet markup (schedule-card, calendar-chip, edit-tank-button), none
 * of which handled Escape, focus, or background scroll.
 *
 * PORTAL is not optional: the calendar grid fades padding days with `opacity`,
 * and opacity creates a stacking context that a plain `position: fixed` child
 * cannot escape — the dialog inherited the translucency. Rendering into
 * document.body is what fixes it, so keep it.
 */

import { useCallback, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  open,
  onClose,
  title,
  actions,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** extra controls rendered left of the close button (e.g. delete) */
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !sheetRef.current) return;
      // focus trap: Tab past either end wraps instead of escaping to the page
      const items = Array.from(sheetRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  // lock background scroll while open, and hand focus back to whatever opened
  // the dialog on close (otherwise focus falls to <body> and keyboard users
  // restart from the top of the page)
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const raf = requestAnimationFrame(() => {
      const target =
        sheetRef.current?.querySelector<HTMLElement>(FOCUSABLE) ?? sheetRef.current ?? null;
      target?.focus();
    });
    return () => {
      cancelAnimationFrame(raf);
      document.body.style.overflow = prevOverflow;
      opener?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="modal-scrim" onClick={onClose} onKeyDown={onKeyDown}>
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="modal-sheet"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 mb-4">
          <h2 id={titleId} className="text-lg font-semibold">
            {title}
          </h2>
          <div className="flex items-center gap-1">
            {actions}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="icon-btn icon-btn-sm icon-btn-bare"
            >
              <i aria-hidden className="ph ph-x text-base" />
            </button>
          </div>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** The delete control every schedule dialog puts next to the close button. */
export function ModalDeleteButton({
  onClick,
  disabled,
  label = "Delete schedule",
}: {
  onClick: () => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="icon-btn icon-btn-sm icon-btn-danger"
    >
      <i aria-hidden className="ph ph-trash text-base" />
    </button>
  );
}
