/**
 * Water parameter target ranges + NH3 calculation.
 * Sources: research doc §1.3 (validated ranges), Emerson et al. 1975 for NH3.
 *
 * RANGES: [min, max] = target band; warnMin/warnMax = critical thresholds.
 * Values OUTSIDE [min,max] but inside warn bounds = "warn";
 * beyond warnMin/warnMax (or outside the band when no warn is set) = "critical".
 * NH3 (free ammonia) — NOT raw NH4 — is what decides the ammonia verdict.
 */

export type Range = {
  key: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  warnMin?: number;
  warnMax?: number;
};

export const FRESHWATER_RANGES: Range[] = [
  // Bands re-derived from research §1.3 (issue #9): target 24–26, critical <22 / >28
  { key: "temp", label: "Temperature", unit: "°C", min: 24, max: 26, warnMin: 22, warnMax: 28 },
  // target 6.5–7.5, critical <6.0 / >8.0
  { key: "ph", label: "pH", unit: "", min: 6.5, max: 7.5, warnMin: 6.0, warnMax: 8.0 },
  // target 4–8, critical <3 / >10
  { key: "kh", label: "KH (carbonate hardness)", unit: "°dKH", min: 4, max: 8, warnMin: 3, warnMax: 10 },
  { key: "gh", label: "GH (total hardness)", unit: "°dGH", min: 6, max: 12, warnMin: 4, warnMax: 16 },
  { key: "co2", label: "CO₂", unit: "mg/l", min: 20, max: 30, warnMin: 10, warnMax: 35 },
  // NO2 target = 0 in established tanks (review R1); 0.1–0.2 = warning, >0.2 critical
  { key: "no2", label: "Nitrite (NO₂)", unit: "mg/l", min: 0, max: 0.09, warnMax: 0.2 },
  { key: "no3", label: "Nitrate (NO₃)", unit: "mg/l", min: 5, max: 25, warnMin: 2, warnMax: 50 },
  // NH4 total stored raw; NH3 (computed) is what gets evaluated
  { key: "nh4", label: "Ammonium (NH₄ total)", unit: "mg/l", min: 0, max: 0.5, warnMax: 1 },
  { key: "po4", label: "Phosphate (PO₄)", unit: "mg/l", min: 0.1, max: 1.0, warnMax: 2 },
  { key: "fe", label: "Iron (Fe)", unit: "mg/l", min: 0.05, max: 0.3, warnMax: 0.5 },
  { key: "cl2", label: "Chlorine (Cl₂)", unit: "mg/l", min: 0, max: 0, warnMax: 0.05 },
  { key: "o2", label: "Oxygen (O₂)", unit: "mg/l", min: 6, max: 12, warnMin: 4 },
];

/**
 * Saltwater: NO 'kh' — alkalinity IS the marine KH measurement and gets its
 * own reef-appropriate band (issue #18). no3 kept for now (freshwater band
 * inherited) — flagged in the issue; saltwater-specific band decision pending.
 */
export const SALTWATER_RANGES: Range[] = [
  ...FRESHWATER_RANGES.filter((r) => !["gh", "fe", "po4", "kh"].includes(r.key)),
  { key: "salinity", label: "Salinity", unit: "SG", min: 1.023, max: 1.025, warnMin: 1.020, warnMax: 1.027 },
  { key: "ca", label: "Calcium (Ca)", unit: "mg/l", min: 380, max: 450, warnMin: 360, warnMax: 470 },
  { key: "mg", label: "Magnesium (Mg)", unit: "mg/l", min: 1250, max: 1350, warnMin: 1200, warnMax: 1400 },
  { key: "alkalinity", label: "Alkalinity (KH)", unit: "°dKH", min: 7, max: 11, warnMin: 6, warnMax: 12 },
];

export const DEFAULT_ACTIONS: string[] = ["water_change", "fertilize", "filter_change", "filter_clean"];

/**
 * Free ammonia (NH3) from total ammonium (NH4), pH and temperature.
 * Emerson et al. 1975 — pKa of the NH4+/NH3 equilibrium depends on temperature.
 *
 * fraction(NH3) = 1 / (1 + 10^(pKa - pH))
 * NH3 = NH4_total * fraction
 */
export function nh3FromNh4(nh4Total: number, ph: number, tempC: number): number {
  // pKa regression (Emerson 1975), valid ~0–30 °C freshwater
  const pKa = 0.09018 + 2729.92 / (tempC + 273.15);
  const fraction = 1 / (1 + Math.pow(10, pKa - ph));
  return nh4Total * fraction;
}

/** Critical NH3 threshold — toxic for fish above this (review R1). */
export const NH3_CRITICAL_MG_L = 0.02;
/**
 * Warning threshold below critical. US EPA Water Quality Criteria cite
 * chronic-effects levels for unionized ammonia in the low 0.01 s mg/l range
 * (EPA 2013 Aquatic Life Criteria, fresh water); we flag ≥ 0.012 as "warn"
 * before reaching the acute-critical 0.02 band.
 */
export const NH3_WARN_MG_L = 0.012;

export type EvalResult = {
  key: string;
  value: number;
  status: "ok" | "warn" | "critical";
  message?: string;
};

/**
 * Evaluate a water test. Ammonium produces TWO results (issue #10):
 *   1. the raw NH4 total (so charts/history keep the measured value), and
 *   2. the calculated free NH3 — which carries the ammonia verdict
 *      (ok → warn ≥ 0.012 → critical ≥ 0.02).
 * tankState cycling → NO2/NH3 peaks get "warn" instead of "critical"
 * (they're expected during cycling; AI/UX shouldn't panic).
 */
export function evaluateWaterTest(
  values: Record<string, number | null>,
  ranges: Range[],
  ctx: { ph?: number | null; temp?: number | null; tankState: "cycling" | "established" },
): EvalResult[] {
  const results: EvalResult[] = [];
  const cycling = ctx.tankState === "cycling";

  for (const r of ranges) {
    const v = values[r.key];
    if (v === undefined || v === null) continue;

    if (r.key === "nh4") {
      const ph = ctx.ph ?? values["ph"] ?? null;
      const temp = ctx.temp ?? values["temp"] ?? null;
      if (ph !== null && temp !== null) {
        // 1) raw NH4 total — the value the user measured (keep for charts)
        results.push({ key: "nh4", value: v, status: bandStatus(v, r) });
        // 2) calculated NH3 — three-tier verdict incl. warn band
        const nh3 = nh3FromNh4(v, ph, temp);
        let status: EvalResult["status"];
        if (nh3 >= NH3_CRITICAL_MG_L) status = cycling ? "warn" : "critical";
        else if (nh3 >= NH3_WARN_MG_L) status = "warn";
        else status = "ok";
        results.push({
          key: "nh3",
          value: nh3,
          status,
          message: `Free NH₃ ${nh3.toFixed(3)} mg/l (from NH₄ ${v} at pH ${ph}, ${temp}°C)`,
        });
        continue;
      }
      // no pH/temp → fall through to raw NH4 band evaluation
    }

    // cycling tolerance for NO2 (R1): demote critical → warn
    let status = bandStatus(v, r);
    if (r.key === "no2" && cycling && status === "critical") {
      status = "warn";
    }

    results.push({ key: r.key, value: v, status });
  }

  return results;
}

function bandStatus(v: number, r: Range): EvalResult["status"] {
  let status: EvalResult["status"] = "ok";
  if (v < r.min || v > r.max) status = "warn";
  if (r.warnMin !== undefined && v < r.warnMin) status = "critical";
  if (r.warnMax !== undefined && v > r.warnMax) status = "critical";
  return status;
}
