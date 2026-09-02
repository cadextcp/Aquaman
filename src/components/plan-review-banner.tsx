"use client";

/**
 * Plan review banner in the coach tab (proactive coach):
 * - thinking → "The coach is reviewing your plan… (changed parameters)" info line
 * - ready    → summary + clickable recommendation chips; click sends the prompt into
 *   the chat and marks the review as seen (idle)
 * - dismissed via the close button → marks reviewed
 */

import { useCallback, useEffect, useState } from "react";
import { usePlanReviewBadge } from "./coach-badge";
import { HelpDot } from "./ui/help";
import { useI18n } from "@/i18n/provider";

type PlanReviewResponse = {
  state?: string;
  reason?: string;
  summary?: string;
  prompts?: { label: string; prompt: string }[];
};

export function PlanReviewBanner({ onUsePrompt }: { onUsePrompt: (prompt: string) => void }) {
  const { t } = useI18n();
  const badge = usePlanReviewBadge();
  const [data, setData] = useState<PlanReviewResponse | null>(null);
  const [hidden, setHidden] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/coach/plan-review");
      if (res.ok) setData((await res.json()) as PlanReviewResponse);
    } catch {
      /* keep last */
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, [load]);

  // banner is hidden once dismissed or after state left ready/thinking
  useEffect(() => {
    if (data?.state === "idle") setHidden(true);
  }, [data?.state]);

  async function markReviewed() {
    setHidden(true);
    await fetch("/api/coach/plan-review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "reviewed" }),
    }).catch(() => {});
  }

  if (hidden) return null;

  // thinking / pending → info line (the coach tab must say WHY it's busy)
  if (data?.state === "thinking" || badge.state === "thinking" || data?.state === "pending") {
    const why = data?.reason === "water_test" ? t("coach.reviewWhyWaterTest") : t("coach.reviewWhyParams");
    return (
      <div
        className="rounded-xl px-4 py-3 mb-3 flex items-center gap-3 text-sm"
        style={{ background: "var(--accent-soft)", boxShadow: "inset 0 0 0 1px var(--accent-edge)" }}
      >
        <span
          aria-hidden
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: "var(--accent-light)",
            animation: "coach-pulse 1.6s ease-in-out infinite",
            flexShrink: 0,
          }}
        />
        <span style={{ color: "var(--muted-foreground)" }}>
          {t("coach.reviewThinking", { why })}
        </span>
      </div>
    );
  }

  if (data?.state === "ready" && Array.isArray(data.prompts) && data.prompts.length > 0) {
    return (
      <div
        className="rounded-xl p-4 mb-4"
        style={{ background: "var(--due-soft)", boxShadow: "inset 0 0 0 1px var(--due-edge)" }}
      >
        <div className="flex items-start justify-between gap-2 mb-2">
          <div>
            <div className="text-sm font-medium flex items-center gap-1">
              {t("coach.reviewReady")}
              <HelpDot id="planReview" />
            </div>
            {data.summary && (
              <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                {data.summary}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={markReviewed}
            aria-label={t("common.dismiss")}
            className="icon-btn icon-btn-sm icon-btn-bare"
          >
            <i aria-hidden className="ph ph-x text-sm" />
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {data.prompts.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => {
                onUsePrompt(p.prompt);
                void markReviewed();
              }}
              className="rounded-full px-3 py-1.5 text-xs"
              style={{
                background: "var(--due-soft)",
                boxShadow: "inset 0 0 0 1px var(--due-edge)",
                color: "var(--due)",
                cursor: "pointer",
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return null;
}
