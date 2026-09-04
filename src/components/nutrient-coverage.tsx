"use client";

/**
 * "Can I actually mix this plan from what I own?" — the fertilize plan's
 * nutrients as chips, green where a product on the shelf delivers them, red
 * where nothing does (docs/plan-produkt-lager.md §5.2).
 *
 * The gap is the point. A covered nutrient is reassurance; an uncovered one
 * is the thing the user would otherwise only discover standing in front of
 * the tank with the wrong bottle in hand.
 *
 * Renders nothing when the plan doses nothing or the shelf is empty: an
 * all-red strip for someone who has not filled the inventory in yet would be
 * a nag, not information.
 */

import Link from "next/link";
import { useI18n } from "@/i18n/provider";
import { NUTRIENTS } from "@/lib/domain/plan-structure";
import { coverFertilizePlan, type InventoryProduct } from "@/lib/domain/inventory";

function symbolOf(key: string): string {
  return NUTRIENTS.find((n) => n.key === key)?.symbol ?? key;
}

export function NutrientCoverage({
  planNutrients,
  products,
  className = "",
}: {
  planNutrients: Record<string, unknown> | null | undefined;
  /** the fertilizer shelf (repo listProducts("fertilizer")) */
  products: InventoryProduct[];
  className?: string;
}) {
  const { t, plural } = useI18n();
  const { covered, uncovered } = coverFertilizePlan(planNutrients, products);

  if (covered.length === 0 && uncovered.length === 0) return null;
  if (products.length === 0) {
    return (
      <div className={`text-xs ${className}`} style={{ color: "var(--muted-foreground)" }}>
        {t("inventory.noFertilizersYet")}{" "}
        <Link href="/inventory" style={{ color: "var(--accent)" }}>
          {t("nav.inventory")}
        </Link>
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-1.5">
        {covered.map((c) => (
          <span
            key={c.key}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px]"
            style={{ background: "var(--success-soft)", color: "var(--foreground)" }}
            // the whole point of the chip is WHICH bottle — on a phone there is
            // no hover, so the names go in the text below too when it is a gap
            title={c.providedBy.map((p) => p.name).join(", ")}
          >
            <i aria-hidden className="ph ph-check text-[10px]" style={{ color: "var(--success)" }} />
            <span className="font-medium">{symbolOf(c.key)}</span>
            <span style={{ color: "var(--muted-foreground)" }}>{c.providedBy[0].name}</span>
            {c.providedBy.length > 1 && (
              <span style={{ color: "var(--faint)" }}>+{c.providedBy.length - 1}</span>
            )}
          </span>
        ))}
        {uncovered.map((c) => (
          <span
            key={c.key}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px]"
            style={{ background: "var(--destructive-soft)", color: "var(--foreground)" }}
          >
            <i aria-hidden className="ph ph-warning text-[10px]" style={{ color: "var(--destructive)" }} />
            <span className="font-medium">{symbolOf(c.key)}</span>
            <span style={{ color: "var(--muted-foreground)" }}>{c.dose}</span>
          </span>
        ))}
      </div>
      {uncovered.length > 0 && (
        <div className="text-xs mt-1" style={{ color: "var(--muted-foreground)" }}>
          {plural("inventory.uncoveredHint", uncovered.length, {
            nutrients: uncovered.map((c) => symbolOf(c.key)).join(", "),
          })}
        </div>
      )}
    </div>
  );
}
