import { describe, it, expect } from "vitest";
import {
  nh3FromNh4,
  evaluateWaterTest,
  NH3_CRITICAL_MG_L,
  NH3_WARN_MG_L,
  FRESHWATER_RANGES,
  SALTWATER_RANGES,
} from "../src/lib/domain/ranges";

describe("nh3FromNh4 (Emerson 1975)", () => {
  it("NH4 0.5 mg/l at pH 6.5, 25°C → NH3 well below critical (harmless)", () => {
    const nh3 = nh3FromNh4(0.5, 6.5, 25);
    expect(nh3).toBeLessThan(NH3_CRITICAL_MG_L);
  });
  it("NH4 0.5 mg/l at pH 8.2, 25°C → NH3 CRITICAL (toxic)", () => {
    const nh3 = nh3FromNh4(0.5, 8.2, 25);
    expect(nh3).toBeGreaterThan(NH3_CRITICAL_MG_L);
    expect(nh3).toBeGreaterThan(0.04);
  });
  it("higher temperature shifts equilibrium toward NH3", () => {
    expect(nh3FromNh4(1, 7.5, 28)).toBeGreaterThan(nh3FromNh4(1, 7.5, 20));
  });
});

describe("evaluateWaterTest — ammonium produces nh4 AND nh3 (issue #10)", () => {
  it("returns BOTH the raw NH4 total and the calculated NH3", () => {
    const res = evaluateWaterTest(
      { ph: 8.2, temp: 25, nh4: 0.5 },
      FRESHWATER_RANGES,
      { tankState: "established", ph: 8.2, temp: 25 },
    );
    const nh4 = res.find((r) => r.key === "nh4");
    const nh3 = res.find((r) => r.key === "nh3");
    expect(nh4).toBeDefined();
    expect(nh4!.value).toBe(0.5); // raw measured value preserved
    expect(nh3).toBeDefined();
    expect(nh3!.status).toBe("critical");
  });

  it("NH3 just under critical → warn, not ok (three-tier band)", () => {
    // find NH4 total that yields NH3 between WARN (0.012) and CRITICAL (0.02)
    // at pH 8.0, 25°C: fraction ≈ 0.0566 → nh4 0.3 → nh3 ≈ 0.017 (warn zone)
    const nh3 = nh3FromNh4(0.3, 8.0, 25);
    expect(nh3).toBeGreaterThanOrEqual(NH3_WARN_MG_L);
    expect(nh3).toBeLessThan(NH3_CRITICAL_MG_L);
    const res = evaluateWaterTest({ nh4: 0.3 }, FRESHWATER_RANGES, { ph: 8.0, temp: 25, tankState: "established" });
    expect(res.find((r) => r.key === "nh3")!.status).toBe("warn");
  });

  it("low NH3 stays ok", () => {
    // pH 6.5: fraction tiny → nh3 ≈ 0.000066 mg/l
    const res = evaluateWaterTest({ nh4: 0.5 }, FRESHWATER_RANGES, { ph: 6.5, temp: 25, tankState: "established" });
    expect(res.find((r) => r.key === "nh3")!.status).toBe("ok");
  });

  it("cycling tank demotes NH3 critical → warn", () => {
    const res = evaluateWaterTest({ nh4: 0.5 }, FRESHWATER_RANGES, { ph: 8.2, temp: 25, tankState: "cycling" });
    expect(res.find((r) => r.key === "nh3")!.status).toBe("warn");
  });

  it("cycling tank demotes NO2 critical → warn (R1 tolerance)", () => {
    const established = evaluateWaterTest({ no2: 0.5 }, FRESHWATER_RANGES, { tankState: "established" });
    const cycling = evaluateWaterTest({ no2: 0.5 }, FRESHWATER_RANGES, { tankState: "cycling" });
    expect(established.find((r) => r.key === "no2")!.status).toBe("critical");
    expect(cycling.find((r) => r.key === "no2")!.status).toBe("warn");
  });
});

describe("freshwater bands match research §1.3 (issue #9 — pinned)", () => {
  const byKey = Object.fromEntries(FRESHWATER_RANGES.map((r) => [r.key, r]));

  it("temperature: target 24–26, critical outside 22–28", () => {
    expect(byKey.temp.min).toBe(24);
    expect(byKey.temp.max).toBe(26);
    expect(byKey.temp.warnMin).toBe(22);
    expect(byKey.temp.warnMax).toBe(28);
    expect(evaluateWaterTest({ temp: 29 }, FRESHWATER_RANGES, { tankState: "established" })[0].status).toBe("critical");
    expect(evaluateWaterTest({ temp: 27 }, FRESHWATER_RANGES, { tankState: "established" })[0].status).toBe("warn");
  });

  it("pH: target 6.5–7.5, critical outside 6.0–8.0", () => {
    expect(byKey.ph.min).toBe(6.5);
    expect(byKey.ph.max).toBe(7.5);
    expect(byKey.ph.warnMin).toBe(6.0);
    expect(byKey.ph.warnMax).toBe(8.0);
  });

  it("KH: target 4–8, critical outside 3–10", () => {
    expect(byKey.kh.min).toBe(4);
    expect(byKey.kh.max).toBe(8);
    expect(byKey.kh.warnMin).toBe(3);
    expect(byKey.kh.warnMax).toBe(10);
  });
});

describe("saltwater ranges (issue #18 — pinned)", () => {
  it("contains alkalinity but NOT kh (same measurement, one band)", () => {
    expect(SALTWATER_RANGES.filter((r) => r.key === "kh")).toHaveLength(0);
    expect(SALTWATER_RANGES.filter((r) => r.key === "alkalinity")).toHaveLength(1);
  });
  it("keeps saltwater-specific parameters", () => {
    const keys = SALTWATER_RANGES.map((r) => r.key);
    expect(keys).toContain("salinity");
    expect(keys).toContain("ca");
    expect(keys).toContain("mg");
    expect(keys).not.toContain("gh");
  });
});

describe("misc evaluations", () => {
  it("missing values are skipped", () => {
    const res = evaluateWaterTest({ temp: 25 }, FRESHWATER_RANGES, { tankState: "established" });
    expect(res).toHaveLength(1);
    expect(res[0].status).toBe("ok");
  });
  it("nitrate 60 → critical (60 > warnMax 50)", () => {
    const res = evaluateWaterTest({ no3: 60 }, FRESHWATER_RANGES, { tankState: "established" });
    expect(res.find((r) => r.key === "no3")!.status).toBe("critical");
  });
});
