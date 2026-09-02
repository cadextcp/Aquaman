"use client";

/**
 * Plan recommendation banner (issue #42):
 * - tank has no plans yet → "create an initial plan" (all 5 standard types)
 * - master data changed → recommend updating (the page computes missing types;
 *   for the update case the banner offers the coach with the right prompt)
 * Dismissible per session (not persisted — it should return tomorrow).
 */

import { useState } from "react";
import Link from "next/link";
import { useI18n } from "@/i18n/provider";

export function PlanRecommendBanner({
  tankId,
  tankName,
  missingPlans,
  hasAnyPlans,
}: {
  tankId: number;
  tankName: string;
  missingPlans: readonly string[];
  hasAnyPlans: boolean;
}) {
  // `actionLabel`, not a local `t` — the old helper was named `t` and would
  // shadow the translator (the same trap as on the dashboard and calendar).
  const { t, plural, actionLabel } = useI18n();
  const [dismissed, setDismissed] = useState(false);
  if (dismissed || missingPlans.length === 0) return null;

  const isInitial = !hasAnyPlans;
  const missingList = missingPlans.map(actionLabel);
  // The prompt lands in the chat as the user's own message, so it follows the
  // app language too; the coach answers in it either way (system directive).
  const coachPrompt = isInitial
    ? t("coach.promptInitial", { tank: tankName, id: tankId })
    : t("coach.promptUpdate", { tank: tankName, id: tankId, plans: missingList.join(", ") });

  return (
    <div
      className="rounded-xl p-4 mb-4 flex items-start gap-3"
      style={{ background: "var(--accent-soft)", boxShadow: "inset 0 0 0 1px var(--accent-edge)" }}
    >
      <i aria-hidden className="ph ph-seal-check mt-0.5" style={{ color: "var(--accent)" }} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">
          {isInitial ? t("coach.recommendInitialTitle") : t("coach.recommendUpdateTitle")}
        </div>
        <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>
          {isInitial
            ? t("coach.recommendInitialBody")
            : plural("coach.recommendUpdateBody", missingPlans.length, { plans: missingList.join(", ") })}
        </p>
        <div className="flex flex-wrap gap-2 mt-2">
          <Link
            href={`/coach?q=${encodeURIComponent(coachPrompt)}`}
            className="btn-outline rounded-lg px-3 py-1.5 text-xs"
            style={{ minHeight: 34 }}
          >
            {t("coach.recommendAsk")}
          </Link>
          <details className="text-xs">
            <summary className="cursor-pointer select-none" style={{ color: "var(--muted-foreground)" }}>
              {t("coach.recommendManual", { n: missingPlans.length })}
            </summary>
            <span className="block mt-1" style={{ color: "var(--faint)" }}>
              {t("coach.recommendManualHint", { plans: missingList.join(" · ") })}
            </span>
          </details>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label={t("common.dismiss")}
        className="icon-btn icon-btn-sm icon-btn-bare"
      >
        <i aria-hidden className="ph ph-x text-sm" />
      </button>
    </div>
  );
}
