"use client";

/**
 * Feeding control (issue #32): tank name links to the tank detail page; next
 * to it a real checkbox-look element with a −/+ stepper. Mis-tap undo = one
 * tap on −. Bounds 0..5 (server enforces too). Replaces the undiscoverable
 * 1→2→0 cycle.
 */

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { adjustFeedToday } from "@/app/actions";

export function FeedControl({
  tankId,
  tankName,
  timesFed,
}: {
  tankId: number;
  tankName: string;
  timesFed: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  async function adjust(delta: 1 | -1) {
    await adjustFeedToday(tankId, delta);
    startTransition(() => router.refresh());
  }

  const fed = timesFed > 0;

  return (
    <div
      className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 w-full"
      style={{ background: "var(--secondary)", minHeight: 48 }}
    >
      {/* tank name = link to the tank (was: invisible tap target) */}
      <Link
        href={`/tanks/${tankId}`}
        className="text-sm font-medium underline decoration-dotted underline-offset-4"
        style={{ color: "var(--secondary-foreground)", cursor: "pointer" }}
      >
        {tankName} <span aria-hidden>→</span>
      </Link>

      <div className="flex items-center gap-1.5">
        {/* the checkbox-ish status chip */}
        <span
          aria-label={fed ? `${tankName}: fed ${timesFed}× today` : `${tankName}: not fed yet today`}
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm select-none"
          style={{
            background: fed ? "var(--primary)" : "transparent",
            color: fed ? "var(--primary-foreground)" : "var(--muted-foreground)",
            border: fed ? "none" : "1px dashed var(--border)",
            minWidth: 72,
            justifyContent: "center",
          }}
        >
          <span aria-hidden>{fed ? "☑" : "☐"}</span>
          <span className="font-medium">{fed ? `Fed ${timesFed}×` : "Feed"}</span>
        </span>

        {/* stepper: − undo mis-taps, + feeds */}
        <button
          type="button"
          onClick={() => adjust(-1)}
          disabled={pending || timesFed === 0}
          aria-label={`Undo feeding for ${tankName}`}
          className="rounded-md text-lg leading-none font-bold"
          style={{
            width: 36,
            height: 36,
            background: "var(--card)",
            border: "1px solid var(--border)",
            color: timesFed === 0 ? "var(--muted-foreground)" : "var(--secondary-foreground)",
            cursor: timesFed === 0 ? "not-allowed" : "pointer",
            opacity: timesFed === 0 ? 0.4 : 1,
          }}
        >
          −
        </button>
        <button
          type="button"
          onClick={() => adjust(1)}
          disabled={pending || timesFed >= 5}
          aria-label={`Feed ${tankName} once more`}
          className="rounded-md text-lg leading-none font-bold"
          style={{
            width: 36,
            height: 36,
            background: "var(--accent)",
            border: "1px solid transparent",
            color: "#fff",
            cursor: timesFed >= 5 ? "not-allowed" : "pointer",
            opacity: timesFed >= 5 ? 0.5 : 1,
          }}
        >
          +
        </button>
      </div>
    </div>
  );
}
