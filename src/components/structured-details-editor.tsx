"use client";

/**
 * Structured details editor (issue #42): renders type-specific inputs instead
 * of free text for standard plan types —
 * - water_change: percentage slider/number → formats "30 % (18 L of 60 L)"
 * - water_top_up: liters number → formats "12 L"
 * - fertilize: dose per nutrient from the fixed catalog (macro + micro)
 * - feed: amount per food type defined at the tank
 * Free text stays available for types with no structured editor (and as a rendered preview).
 */

import { NUTRIENTS, formatDetailData } from "@/lib/domain/plan-structure";
import { useI18n } from "@/i18n/provider";

type DetailData = Record<string, unknown>;

export function StructuredDetailsEditor({
  actionType,
  tankVolumeL,
  tankFoods,
  value,
  onChange,
}: {
  actionType: string;
  tankVolumeL: number;
  tankFoods: { name: string; amount: string; unit: string }[];
  value: DetailData | null;
  onChange: (data: DetailData | null, rendered: string) => void;
}) {
  const { t, nutrientLabel } = useI18n();
  if (actionType === "water_change") {
    const pct = Number(value?.percent ?? 30);
    return (
      <div>
        <label className="block text-xs uppercase tracking-wide mb-1.5" style={{ color: "var(--muted-foreground)" }}>
          {t("schedule.waterChangeAmount")}
        </label>
        <div className="flex items-center gap-3">
          <input
            type="range" min={5} max={90} step={5}
            value={pct}
            onChange={(e) => onChange({ percent: Number(e.target.value) }, formatDetailData("water_change", { percent: Number(e.target.value) }, tankVolumeL))}
            className="flex-1"
            style={{ accentColor: "var(--accent)" }}
          />
          <span className="text-sm tnum w-28 text-right font-medium">{pct} %</span>
        </div>
        <p className="text-xs tnum mt-1" style={{ color: "var(--faint)" }}>
          {t("schedule.waterChangeApprox", { liters: Math.round((pct / 100) * tankVolumeL), total: tankVolumeL })}
        </p>
      </div>
    );
  }

  if (actionType === "water_top_up") {
    const liters = Number(value?.liters ?? 5);
    return (
      <div>
        <label className="block text-xs uppercase tracking-wide mb-1.5" style={{ color: "var(--muted-foreground)" }}>
          {t("schedule.topUpAmount")}
        </label>
        <div className="flex items-center gap-3">
          <input
            type="number" min={1} max={9999} step={1}
            value={liters}
            onChange={(e) => onChange({ liters: Number(e.target.value) }, formatDetailData("water_top_up", { liters: Number(e.target.value) }))}
            className="rounded-md px-2 py-1.5 text-sm w-24"
            style={{ background: "var(--surface)", boxShadow: "inset 0 0 0 1px var(--border)", color: "inherit" }}
          />
          <span className="text-sm" style={{ color: "var(--muted-foreground)" }}>L</span>
        </div>
      </div>
    );
  }

  if (actionType === "fertilize") {
    const nutrients = (value?.nutrients as Record<string, string> | undefined) ?? {};
    function setNutrient(key: string, dose: string) {
      const next = { ...nutrients, [key]: dose };
      const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => v.trim() !== ""));
      onChange(Object.keys(clean).length ? { nutrients: clean } : null, formatDetailData("fertilize", { nutrients: clean }));
    }
    return (
      <div>
        <label className="block text-xs uppercase tracking-wide mb-1.5" style={{ color: "var(--muted-foreground)" }}>
          {t("schedule.nutrientDose")}
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5">
          {NUTRIENTS.map((n) => (
            <label key={n.key} className="flex items-center gap-1.5 text-xs">
              <span className="w-9 shrink-0 font-medium" title={nutrientLabel(n.key, n.label)} style={{ color: n.group === "macro" ? "var(--secondary-foreground)" : "var(--muted-foreground)" }}>
                {n.symbol}
              </span>
              <input
                className="flex-1 min-w-0 rounded-md px-2 py-1.5 text-xs"
                style={{ background: "var(--surface)", boxShadow: "inset 0 0 0 1px var(--border)", color: "inherit" }}
                // a dose is "10 ml", not an essay: every entry is rendered into
                // `details`, which scheduleInputSchema caps at 300 characters
                maxLength={20}
                placeholder={n.group === "macro" ? "—" : "—"}
                value={nutrients[n.key] ?? ""}
                onChange={(e) => setNutrient(n.key, e.target.value)}
              />
            </label>
          ))}
        </div>
        <p className="text-xs mt-1.5" style={{ color: "var(--faint)" }}>
          {t("schedule.nutrientHint")}
        </p>
      </div>
    );
  }

  if (actionType === "feed") {
    const foods = (value?.foods as Record<string, string> | undefined) ?? {};
    function setFood(name: string, amount: string) {
      const next = { ...foods, [name]: amount };
      const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => v.trim() !== ""));
      onChange(Object.keys(clean).length ? { foods: clean } : null, formatDetailData("feed", { foods: clean }));
    }
    if (tankFoods.length === 0) {
      return (
        <p className="text-xs rounded-lg p-2.5" style={{ background: "var(--secondary)", color: "var(--muted-foreground)" }}>
          {t("schedule.noFoodsYet")}
        </p>
      );
    }
    return (
      <div>
        <label className="block text-xs uppercase tracking-wide mb-1.5" style={{ color: "var(--muted-foreground)" }}>
          {t("schedule.foodAmount")}
        </label>
        <div className="space-y-1.5">
          {tankFoods.map((f) => (
            <label key={f.name} className="flex items-center gap-2 text-xs">
              <span className="w-28 shrink-0 truncate" title={f.name}>{f.name}</span>
              <input
                className="flex-1 min-w-0 rounded-md px-2 py-1.5 text-xs"
                style={{ background: "var(--surface)", boxShadow: "inset 0 0 0 1px var(--border)", color: "inherit" }}
                maxLength={20}
                placeholder={f.amount ? t("schedule.foodPlaceholder", { amount: f.amount, unit: f.unit }) : t("schedule.foodPlaceholderEmpty")}
                value={foods[f.name] ?? ""}
                onChange={(e) => setFood(f.name, e.target.value)}
              />
            </label>
          ))}
        </div>
      </div>
    );
  }

  // filter_change, water_test, custom → no structured editor (free text only)
  return null;
}
