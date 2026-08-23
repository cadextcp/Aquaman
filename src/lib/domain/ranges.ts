/**
 * Water parameter target ranges + NH3 calculation.
 * Sources: research doc §1.3 (validated ranges), Emerson et al. 1975 for NH3.
 *
 * RANGES: [min, max] = target band; warnMin/warnMax = warning thresholds.
 * NH3 (free ammonia) — NOT raw NH4 — is what we evaluate.
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
  { key: "temp", label: "Temperature", unit: "°C", min: 22, max: 28, warnMin: 20, warnMax: 30 },
  { key: "ph", label: "pH", unit: "", min: 6.5, max: 7.8, warnMin: 6.0, warnMax: 8.4 },
  { key: "kh", label: "KH (carbonate hardness)", unit: "°dKH", min: 4, max: 8, warnMin: 3, warnMax: 12 },
  { key: "gh", label: "GH (total hardness)", unit: "°dGH", min: 6, max: 12, warnMin: 4, warnMax: 16 },
  { key: "co2", label: "CO₂", unit: "mg/l", min: 20, max: 30, warnMin: 10, warnMax: 35 },
  // NO2 target = 0 in established tanks (review R1); 0.1–0.2 = warning
  { key: "no2", label: "Nitrite (NO₂)", unit: "mg/l", min: 0, max: 0.09, warnMin: undefined, warnMax: 0.2 },
  { key: "no3", label: "Nitrate (NO₃)", unit: "mg/l", min: 5, max: 25, warnMin: 2, warnMax: 50 },
  // NH4 total stored raw; NH3 (computed) is what gets evaluated
  { key: "nh4", label: "Ammonium (NH₄ total)", unit: "mg/l", min: 0, max: 0.5, warnMax: 1 },
  { key: "po4", label: "Phosphate (PO₄)", unit: "mg/l", min: 0.1, max: 1.0, warnMax: 2 },
  { key: "fe", label: "Iron (Fe)", unit: "mg/l", min: 0.05, max: 0.3, warnMax: 0.5 },
  { key: "cl2", label: "Chlorine (Cl₂)", unit: "mg/l", min: 0, max: 0, warnMax: 0.05 },
  { key: "o2", label: "Oxygen (O₂)", unit: "mg/l", min: 6, max: 12, warnMin: 4 },
];

export const SALTWATER_RANGES: Range[] = [
  ...FRESHWATER_RANGES.filter((r) => !["gh", "fe", "po4"].includes(r.key)),
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

export type EvalResult = {
  key: string;
  value: number;
  status: "ok" | "warn" | "critical";
  message?: string;
};

/**
 * Evaluate a water test. For ammonium, computes NH3 and evaluates THAT value.
 * tankState cycling → NO2/NH3 peaks get status "warn" instead of "critical"
 * (they're expected during cycling; AI/UX shouldn't panic).
 */
export function evaluateWaterTest(
  values: Record<string, number | null>,
  ranges: Range[],
  ctx: { ph?: number | null; temp?: number | null; tankState: "cycling" | "established" },
): EvalResult[] {
  const results: EvalResult[] = [];

  for (const r of ranges) {
    const v = values[r.key];
    if (v === undefined || v === null) continue;

    if (r.key === "nh4") {
      const ph = ctx.ph ?? values["ph"] ?? null;
      const temp = ctx.temp ?? values["temp"] ?? null;
      if (ph !== null && temp !== null) {
        const nh3 = nh3FromNh4(v, ph, temp);
        const cycling = ctx.tankState === "cycling";
        results.push({
          key: "nh3",
          value: nh3,
          status: nh3 >= NH3_CRITICAL_MG_L ? (cycling ? "warn" : "critical") : "ok",
          message: `Free NH₃ ${nh3.toFixed(3)} mg/l (from NH₄ ${v} at pH ${ph}, ${temp}°C)`,
        });
        continue;
      }
      // no pH/temp → fall through to raw NH4 band evaluation
    }

    let status: EvalResult["status"] = "ok";
    if (v < r.min || v > r.max) status = "warn";
    if (r.warnMin !== undefined && v < r.warnMin) status = "critical";
    if (r.warnMax !== undefined && v > r.warnMax) status = "critical";

    // cycling tolerance for NO2 (R1): demote critical → warn
    if (r.key === "no2" && ctx.tankState === "cycling" && status === "critical") {
      status = "warn";
    }

    results.push({ key: r.key, value: v, status });
  }

  return results;
}
