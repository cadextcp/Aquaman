"use client";

/**
 * Nocturne feeding control (issue #43): 5 pips (0–5), −/+ stepper, bubble
 * animation on feed, tank name links to the tank. Bounds 0..5 enforced
 * server-side too (adjustFeedOn). `day` comes from the dashboard's day
 * navigation — today, or a past day within the 30-day backfill window
 * (owner request: "edit past days if I forget to add feeding").
 */

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { adjustFeedOn } from "@/app/actions";
import { useI18n } from "@/i18n/provider";

type Bubble = { id: number; left: string; size: string; dx: string; dur: string; delay: string };

export function FeedControl({
  tankId,
  tankName,
  timesFed,
  day,
}: {
  tankId: number;
  tankName: string;
  timesFed: number;
  day: string;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const [pending, startTransition] = useTransition();
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [error, setError] = useState<string | null>(null);
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
    // A rejected day (stale tab past midnight, hand-edited ?day=) must not fail
    // silently — the refresh would just re-render the unchanged count.
    const res = await adjustFeedOn(tankId, day, delta);
    setError(res.ok ? null : res.error);
    startTransition(() => router.refresh());
  }

  const fed = timesFed > 0;

  return (
    <>
    <div
      className="edge-card flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 w-full"
      style={{ minHeight: 52 }}
    >
      <Link
        href={`/tanks/${tankId}`}
        className="flex min-w-0 flex-1 items-center gap-1 text-sm font-medium"
        style={{ color: "var(--foreground)", cursor: "pointer" }}
      >
        <span className="truncate underline decoration-dotted underline-offset-4">{tankName}</span>
        <i aria-hidden className="ph ph-arrow-right text-[10px] shrink-0" />
      </Link>

      <div className="flex shrink-0 items-center gap-2">
        {/* pips */}
        <div className="hidden min-[420px]:flex items-center gap-1" aria-hidden>
          {Array.from({ length: 5 }).map((_, i) => (
            <span
              key={i}
              className="rounded-full"
              style={{
                width: 7,
                height: 7,
                background: i < timesFed ? "var(--due)" : "var(--control-edge)",
                transition: "background 0.2s",
              }}
            />
          ))}
        </div>
        <span
          className="text-xs tnum"
          style={{ color: fed ? "var(--due)" : "var(--faint)", minWidth: 62 }}
          aria-label={fed ? t("feed.ariaFed", { tank: tankName, n: timesFed }) : t("feed.ariaNotFed", { tank: tankName })}
        >
          {fed ? t("feed.fedTimes", { n: timesFed }) : t("feed.notFed")}
        </span>

        {/* stepper */}
        <div className="relative flex items-center gap-1">
          <button
            type="button"
            onClick={() => adjust(-1)}
            disabled={pending || timesFed === 0}
            aria-label={t("feed.undoFeeding", { tank: tankName })}
            className="icon-btn icon-btn-sm"
          >
            <i aria-hidden className="ph ph-minus text-base" />
          </button>
          <button
            type="button"
            onClick={() => adjust(1)}
            disabled={pending || timesFed >= 5}
            aria-label={t("feed.feedOnceMore", { tank: tankName })}
            className="icon-btn icon-btn-sm relative overflow-visible"
            style={
              timesFed >= 5
                ? undefined
                : { background: "var(--due-soft)", boxShadow: "inset 0 0 0 1px var(--due-edge)", color: "var(--due)" }
            }
          >
            <i aria-hidden className="ph ph-plus text-base" />
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
    {error && (
      <p role="alert" className="text-xs px-3" style={{ color: "var(--destructive)" }}>
        {error}
      </p>
    )}
    </>
  );
}
