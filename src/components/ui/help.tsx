"use client";

/**
 * In-app explanations, ebene 2 and 3 of the help plan.
 *
 * HelpNote  — one always-visible line under a heading. No interaction.
 * HelpDot   — a small "?" that opens the full explanation in a sheet.
 *
 * Why a sheet and not `title=`: the phone is the primary device (PRD §7) and
 * touch has no hover, so a `title` tooltip is invisible exactly where the app
 * is actually used. Every explanatory `title` in the app is replaced by one of
 * these.
 */

import { useState } from "react";
import Link from "next/link";
import { Modal } from "./modal";
import { useI18n } from "@/i18n/provider";

/** E2: a quiet one-liner. `id` is a key under help.notes.*. */
export function HelpNote({ id, className = "" }: { id: string; className?: string }) {
  const { helpNote } = useI18n();
  const text = helpNote(id);
  if (!text) return null;
  return (
    <p className={`text-xs mt-1 ${className}`} style={{ color: "var(--muted-foreground)" }}>
      {text}
    </p>
  );
}

/** E3: tappable detail. `id` is a key under help.topics.*. */
export function HelpDot({ id, className = "" }: { id: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const { t, helpTopic } = useI18n();
  const topic = helpTopic(id);
  if (!topic) return null;

  return (
    <>
      <button
        type="button"
        // these controls often sit inside a card that is itself clickable —
        // asking what something means must never also open the editor
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setOpen(true);
        }}
        onKeyDown={(e) => e.stopPropagation()}
        aria-label={t("help.whatDoesThisMean", { term: topic.title })}
        className={`help-dot ${className}`}
      >
        <i aria-hidden className="ph ph-question" />
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title={topic.title}>
        <div className="flex flex-col gap-3">
          {topic.body.map((p, i) => (
            <p key={i} className="text-sm" style={{ color: i === 0 ? "var(--foreground)" : "var(--muted-foreground)" }}>
              {p}
            </p>
          ))}
          {topic.more && (
            <Link
              href={`/more/concepts#${topic.more}`}
              onClick={() => setOpen(false)}
              className="inline-flex items-center gap-1.5 text-sm mt-1"
              style={{ color: "var(--accent-light)" }}
            >
              {t("help.howAquamanPlans")}
              <i aria-hidden className="ph ph-arrow-right text-xs" />
            </Link>
          )}
        </div>
      </Modal>
    </>
  );
}
