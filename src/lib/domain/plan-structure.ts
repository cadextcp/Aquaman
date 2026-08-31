/**
 * Structured care plans (issue #42):
 * - STANDARD_PLAN_TYPES: action types with structured detailData (derived from
 *   the action-types catalog) — exactly one plan per type per tank (duplicate guard)
 * - NUTRIENTS: the fixed fertilizer nutrient catalog (owner list) —
 *   macro: C/CO2, N/NO3, P/PO4, K, Mg, Ca; micro: Fe, Mn, Zn, B, Mo, Cu
 * - formatDetailData(): structured JSON → human-readable one-liner
 * - tankFingerprint(): master-data signature for change detection
 */

import { ACTION_TYPES, type ActionType } from "./action-types";

export const STANDARD_PLAN_TYPES = ACTION_TYPES.filter((a) => a.standardPlan).map((a) => a.key) as ActionType[];
export type StandardPlanType = ActionType;

export type NutrientDef = { key: string; symbol: string; label: string; group: "macro" | "micro" };

/** Owner-specified list (fixed for now, flexible later). */
export const NUTRIENTS: NutrientDef[] = [
  { key: "c_co2", symbol: "CO₂", label: "Kohlenstoff (C) / CO₂", group: "macro" },
  { key: "n_no3", symbol: "NO₃", label: "Stickstoff (N) / Nitrat", group: "macro" },
  { key: "p_po4", symbol: "PO₄", label: "Phosphor (P) / Phosphat", group: "macro" },
  { key: "k", symbol: "K", label: "Kalium (K)", group: "macro" },
  { key: "mg", symbol: "Mg", label: "Magnesium (Mg)", group: "macro" },
  { key: "ca", symbol: "Ca", label: "Calcium (Ca)", group: "macro" },
  { key: "fe", symbol: "Fe", label: "Eisen (Fe)", group: "micro" },
  { key: "mn", symbol: "Mn", label: "Mangan (Mn)", group: "micro" },
  { key: "zn", symbol: "Zn", label: "Zink (Zn)", group: "micro" },
  { key: "b", symbol: "B", label: "Bor (B)", group: "micro" },
  { key: "mo", symbol: "Mo", label: "Molybdän (Mo)", group: "micro" },
  { key: "cu", symbol: "Cu", label: "Kupfer (Cu)", group: "micro" },
];

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

/**
 * Master-data fingerprint for change detection (issue #42): changes to these
 * fields mean existing plans may no longer fit → recommend updating them.
 */
export function tankFingerprint(tank: {
  volumeL: number;
  fish: unknown;
  plants: unknown;
  foods: unknown;
  hasCo2: boolean;
  hasHeater: boolean;
  hasFilter: boolean;
  filterType: string | null;
}): string {
  const stable = (v: unknown) => JSON.stringify(v, Object.keys(v as object).length ? null : undefined);
  void stable;
  const json = (v: unknown) => JSON.stringify(v);
  return [tank.volumeL, json(tank.fish), json(tank.plants), json(tank.foods), tank.hasCo2, tank.hasHeater, tank.hasFilter, tank.filterType ?? ""].join("|");
}
