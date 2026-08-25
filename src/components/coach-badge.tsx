"use client";

/**
 * Coach nav badge (proactive plan review):
 * - thinking → subtle pulsing dot over the coach icon (keyframe, reduced-motion safe)
 * - ready    → notification badge with the number of recommended changes
 * Polls the state every 5s (only mounted once in each nav; cheap JSON).
 * Auto-starts the review when a pending trigger exists and AI is configured —
 * the user never has to know a "start" step exists.
 */

import { useCallback, useEffect, useState } from "react";

export type PlanReviewBadgeState =
  | { state: "idle" | "pending" | "thinking" }
  | { state: "ready"; count: number };

export function usePlanReviewBadge(): PlanReviewBadgeState {
  const [state, setState] = useState<PlanReviewBadgeState>({ state: "idle" });

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/coach/plan-review");
      if (!res.ok) return;
      const data = (await res.json()) as {
        state?: string;
        prompts?: unknown[];
      };
      if (data.state === "thinking" || data.state === "pending") {
        setState({ state: data.state === "thinking" ? "thinking" : "pending" });
        // auto-start when pending (idempotent — the route ignores non-pending)
        if (data.state === "pending") {
          void fetch("/api/coach/plan-review", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "start" }),
          });
        }
      } else if (data.state === "ready" && Array.isArray(data.prompts)) {
        setState({ state: "ready", count: data.prompts.length });
      } else {
        setState({ state: "idle" });
      }
    } catch {
      /* offline → keep last state */
    }
  }, []);

  useEffect(() => {
    void poll();
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, [poll]);

  return state;
}

/** The visual badge: pulsing dot (thinking) or count bubble (ready). */
export function CoachBadge({ state }: { state: PlanReviewBadgeState }) {
  if (state.state === "thinking" || state.state === "pending") {
    return (
      <span
        aria-hidden
        className="absolute"
        style={{
          top: 2,
          right: 8,
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: "var(--accent-light)",
          animation: "coach-pulse 1.6s ease-in-out infinite",
        }}
      />
    );
  }
  if (state.state === "ready") {
    return (
      <span
        aria-label={`${state.count} plan recommendations`}
        className="absolute tnum"
        style={{
          top: 0,
          right: 4,
          minWidth: 16,
          height: 16,
          borderRadius: 8,
          padding: "0 4px",
          background: "var(--due)",
          color: "#0f111c",
          fontSize: 10,
          fontWeight: 700,
          lineHeight: "16px",
          textAlign: "center",
        }}
      >
        {state.count}
      </span>
    );
  }
  return null;
}


import Link from "next/link";

const COACH = { href: "/coach", label: "Coach", icon: "sparkle" } as const;

/** Coach nav item with badge — must live in a client file (uses the hook). */
export function CoachNavItem({ variant }: { variant: "bottom" | "side" }) {
  const badge = usePlanReviewBadge();
  if (variant === "bottom") {
    return (
      <Link
        href={COACH.href}
        className="relative flex flex-col items-center justify-center gap-1 py-2 text-xs"
        style={{ color: "var(--muted-foreground)", minHeight: 56 }}
      >
        <span className="relative">
          <i aria-hidden className={`ph ph-${COACH.icon} text-xl`} />
          <CoachBadge state={badge} />
        </span>
        {COACH.label}
      </Link>
    );
  }
  return (
    <Link
      href={COACH.href}
      className="relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm hover:bg-white/5"
      style={{ color: "var(--secondary-foreground)" }}
    >
      <span className="relative">
        <i aria-hidden className={`ph ph-${COACH.icon} text-lg`} />
        <CoachBadge state={badge} />
      </span>
      {COACH.label}
    </Link>
  );
}
