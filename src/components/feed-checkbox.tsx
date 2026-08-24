"use client";

/**
 * Nocturne feeding control (issue #43): 5 pips (0–5), −/+ stepper, bubble
 * animation on feed, tank name links to the tank. Bounds 0..5 enforced
 * server-side too (adjustFeedToday).
 */

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { adjustFeedToday } from "@/app/actions";

type Bubble = { id: number; left: string; size: string; dx: string; dur: string; delay: string };

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
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const bubbleId = useRef(0);

  function spawnBubbles() {
    const spec: Omit<Bubble, "id">[] = [
      { left: "-2px", size: "5px", dx: "-7px", dur: "1100ms", delay: "0ms" },
      { left: "6px", size: "4px", dx: "5px", dur: "980ms", delay: "90ms" },
      { left: "14px", size: "6px", dx: "-4px", dur: "1250ms", delay: "180ms" },
      { left: "22px", size: "3px", dx: "8px", dur: "900ms", delay: "300ms" },
      { left: "10px", size: "4px", dx: "2px", dur: "1150ms", delay: "420ms" },
    ];
    const batch = spec.map((b) => ({ ...b, id: ++bubbleId.current }));
    setBubbles((prev) => [...prev, ...batch]);
    setTimeout(() => {
      setBubbles((prev) => prev.filter((b) => !batch.some((x) => x.id === b.id)));
    }, 1700);
  }

  async function adjust(delta: 1 | -1) {
    if (delta === 1) spawnBubbles();
    await adjustFeedToday(tankId, delta);
    startTransition(() => router.refresh());
  }

  const fed = timesFed > 0;

  return (
    <div
      className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 w-full"
      style={{ background: "rgba(233,233,237,0.05)", boxShadow: "inset 0 0 0 1px rgba(233,233,237,0.07)", minHeight: 52 }}
    >
      <Link
        href={`/tanks/${tankId}`}
        className="text-sm font-medium underline decoration-dotted underline-offset-4"
        style={{ color: "var(--foreground)", cursor: "pointer" }}
      >
        {tankName} <i aria-hidden className="ph ph-arrow-right text-[10px] align-middle" />
      </Link>

      <div className="flex items-center gap-2">
        {/* pips */}
        <div className="flex items-center gap-1" aria-hidden>
          {Array.from({ length: 5 }).map((_, i) => (
            <span
              key={i}
              className="rounded-full"
              style={{
                width: 7,
                height: 7,
                background: i < timesFed ? "var(--due)" : "rgba(233,233,237,0.12)",
                transition: "background 0.2s",
              }}
            />
          ))}
        </div>
        <span
          className="text-xs tnum"
          style={{ color: fed ? "var(--due)" : "var(--faint)", minWidth: 62 }}
          aria-label={fed ? `${tankName}: fed ${timesFed} times today` : `${tankName}: not fed yet today`}
        >
          {fed ? `fed ${timesFed}×` : "not fed yet"}
        </span>

        {/* stepper */}
        <div className="relative flex items-center gap-1">
          <button
            type="button"
            onClick={() => adjust(-1)}
            disabled={pending || timesFed === 0}
            aria-label={`Undo feeding for ${tankName}`}
            className="rounded-[10px] font-medium text-lg leading-none"
            style={{
              width: 40,
              height: 34,
              background: "rgba(233,233,237,0.05)",
              boxShadow: "inset 0 0 0 1px rgba(233,233,237,0.12)",
              color: timesFed === 0 ? "rgba(233,233,237,0.2)" : "rgba(233,233,237,0.65)",
              cursor: timesFed === 0 ? "not-allowed" : "pointer",
            }}
          >
            −
          </button>
          <button
            type="button"
            onClick={() => adjust(1)}
            disabled={pending || timesFed >= 5}
            aria-label={`Feed ${tankName} once more`}
            className="relative rounded-[10px] text-lg leading-none font-medium overflow-visible"
            style={{
              width: 44,
              height: 34,
              background: timesFed >= 5 ? "rgba(233,233,237,0.05)" : "var(--due-soft)",
              boxShadow: timesFed >= 5 ? "none" : "inset 0 0 0 1px var(--due-edge)",
              color: timesFed >= 5 ? "var(--faint)" : "var(--due)",
              cursor: timesFed >= 5 ? "not-allowed" : "pointer",
            }}
          >
            +
            {/* bubbles rise from the + button on feed */}
            {bubbles.map((b) => (
              <span
                key={b.id}
                className="anim-bub absolute rounded-full"
                style={
                  {
                    left: `calc(50% + ${b.left})`,
                    bottom: "10px",
                    width: b.size,
                    height: b.size,
                    background: "var(--due)",
                    animationDuration: b.dur,
                    animationDelay: b.delay,
                    "--dx": b.dx,
                  } as React.CSSProperties
                }
              />
            ))}
          </button>
        </div>
      </div>
    </div>
  );
}
