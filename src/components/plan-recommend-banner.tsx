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
  const [dismissed, setDismissed] = useState(false);
  if (dismissed || missingPlans.length === 0) return null;

  const label = (t: string) => t.replace(/_/g, " ");
  const isInitial = !hasAnyPlans;
  const coachPrompt = isInitial
    ? `Please create an initial care plan for "${tankName}" (tank ${tankId}) — suggest fertilize, feed, filter change, water change and water test schedules with concrete details.`
    : `My tank "${tankName}" (tank ${tankId}) changed — please review and update the care plan (${missingPlans.map(label).join(", ")} missing).`;

  return (
    <div
      className="rounded-xl p-4 mb-4 flex items-start gap-3"
      style={{ background: "var(--accent-soft)", boxShadow: "inset 0 0 0 1px var(--accent-edge)" }}
    >
      <i aria-hidden className="ph ph-seal-check mt-0.5" style={{ color: "var(--accent)" }} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">
          {isInitial ? "Create an initial care plan" : "Update the care plan"}
        </div>
        <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>
          {isInitial
            ? "Set up the five standard plans — fertilizer, feed, filter change, water change and water test."
            : `Master data changed — ${missingPlans.map(label).join(", ")} ${missingPlans.length === 1 ? "plan is" : "plans are"} missing or may need an update.`}
        </p>
        <div className="flex flex-wrap gap-2 mt-2">
          <Link
            href={`/coach?q=${encodeURIComponent(coachPrompt)}`}
            className="btn-outline rounded-lg px-3 py-1.5 text-xs"
            style={{ minHeight: 34 }}
          >
            Ask the coach to draft it
          </Link>
          <details className="text-xs">
            <summary className="cursor-pointer select-none" style={{ color: "var(--muted-foreground)" }}>
              or add manually ({missingPlans.length})
            </summary>
            <span className="block mt-1" style={{ color: "var(--faint)" }}>
              Scroll to “Care plans” → + add plan: {missingPlans.map(label).join(" · ")}
            </span>
          </details>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="icon-btn icon-btn-sm icon-btn-bare"
      >
        <i aria-hidden className="ph ph-x text-sm" />
      </button>
    </div>
  );
}
