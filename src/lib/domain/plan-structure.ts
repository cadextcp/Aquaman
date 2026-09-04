/**
 * Structured care plans (issue #42):
 * - STANDARD_PLAN_TYPES: action types with structured detailData (derived from
 *   the action-types catalog) — exactly one plan per type per tank (duplicate guard)
 * - NUTRIENTS: the fixed fertilizer nutrient catalog (owner list) —
 *   macro: C/CO2, N/NO3, P/PO4, K, Mg, Ca; micro: Fe, Mn, Zn, B, Mo, Cu
 * - formatDetailData(): structured JSON → human-readable one-liner
 */

import { ACTION_TYPES, type ActionType } from "./action-types";

/**
 * Derived from the catalog's `standardPlan` flag — `feed` is deliberately NOT
 * in here: feeding is the daily counter, so recommending a feeding PLAN (this
 * list drives the tank page's "missing plans" checklist) would push the user
 * into creating a plan nothing can ever tick off.
 */
export const STANDARD_PLAN_TYPES = ACTION_TYPES.filter((a) => a.standardPlan).map((a) => a.key) as ActionType[];
export type StandardPlanType = ActionType;

export type NutrientDef = { key: string; symbol: string; label: string; group: "macro" | "micro" };

/**
 * Owner-specified list (fixed for now, flexible later).
 *
 * `label` is the machine-facing English name, like every other domain label;
 * what a person sees comes from the `nutrient.*` catalog section (these
 * labels used to be German, which read as German words in an English UI).
 * `symbol` is a chemical symbol and stays the same in every language.
 */
export const NUTRIENTS: NutrientDef[] = [
  { key: "c_co2", symbol: "CO₂", label: "Carbon (C) / CO₂", group: "macro" },
  { key: "n_no3", symbol: "NO₃", label: "Nitrogen (N) / nitrate", group: "macro" },
  { key: "p_po4", symbol: "PO₄", label: "Phosphorus (P) / phosphate", group: "macro" },
  { key: "k", symbol: "K", label: "Potassium (K)", group: "macro" },
  { key: "mg", symbol: "Mg", label: "Magnesium (Mg)", group: "macro" },
  { key: "ca", symbol: "Ca", label: "Calcium (Ca)", group: "macro" },
  { key: "fe", symbol: "Fe", label: "Iron (Fe)", group: "micro" },
  { key: "mn", symbol: "Mn", label: "Manganese (Mn)", group: "micro" },
  { key: "zn", symbol: "Zn", label: "Zinc (Zn)", group: "micro" },
  { key: "b", symbol: "B", label: "Boron (B)", group: "micro" },
  { key: "mo", symbol: "Mo", label: "Molybdenum (Mo)", group: "micro" },
  { key: "cu", symbol: "Cu", label: "Copper (Cu)", group: "micro" },
];

/**
 * The nutrient keys as a plain list — the one place zod (productInputSchema)
 * and any other validator may take them from. A second hand-written key list
 * is exactly the divergence AGENTS.md warns about for action-types.ts.
 */
export const NUTRIENT_KEYS = NUTRIENTS.map((n) => n.key) as [string, ...string[]];

export function isNutrientKey(k: string): boolean {
  return NUTRIENTS.some((n) => n.key === k);
}

export function isStandardPlanType(t: string): t is StandardPlanType {
  return (STANDARD_PLAN_TYPES as readonly string[]).includes(t);
}

/**
 * Structured details → human-readable line (also stored in `details`).
 * water_change: { percent } → "30 % (18 L of 60 L)"
 * water_top_up: { liters } → "12 L"
 * fertilize: { nutrients: { fe: "10 ml", k: "5 ml" } } → "Fe 10 ml · K 5 ml"
 * feed: { foods: { "Flakes": "1 pinch", "Frozen": "2 cubes" } } → "Flakes 1 pinch · Frozen 2 cubes"
 */
export function formatDetailData(actionType: string, data: Record<string, unknown> | null | undefined, tankVolumeL?: number): string {
  if (!data || typeof data !== "object") return "";
  if (actionType === "water_change") {
    const pct = Number(data.percent);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return "";
    const liters = tankVolumeL ? ` (${Math.round((pct / 100) * tankVolumeL)} L of ${tankVolumeL} L)` : "";
    return `${pct} %${liters}`;
  }
  if (actionType === "water_top_up") {
    const liters = Number(data.liters);
    if (!Number.isFinite(liters) || liters <= 0) return "";
    return `${liters} L`;
  }
  if (actionType === "fertilize" && data.nutrients && typeof data.nutrients === "object") {
    const parts = Object.entries(data.nutrients as Record<string, unknown>)
      .map(([k, v]) => {
        const n = NUTRIENTS.find((x) => x.key === k);
        return `${n?.symbol ?? k} ${v}`;
      })
      .filter((x) => /\S\d|\d/.test(x));
    return parts.join(" · ");
  }
  if (actionType === "feed" && data.foods && typeof data.foods === "object") {
    const parts = Object.entries(data.foods as Record<string, unknown>)
      .map(([name, amount]) => `${name} ${amount}`)
      .filter((x) => /\d/.test(x));
    return parts.join(" · ");
  }
  return "";
}
