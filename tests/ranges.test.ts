import { describe, it, expect } from "vitest";
import { nh3FromNh4, evaluateWaterTest, NH3_CRITICAL_MG_L, FRESHWATER_RANGES } from "../src/lib/domain/ranges";

describe("nh3FromNh4 (Emerson 1975)", () => {
  it("NH4 0.5 mg/l at pH 6.5, 25°C → NH3 well below critical (harmless)", () => {
    const nh3 = nh3FromNh4(0.5, 6.5, 25);
    expect(nh3).toBeLessThan(NH3_CRITICAL_MG_L);
    expect(nh3).toBeCloseTo(0.5 * (1 / (1 + Math.pow(10, 9.246 - 6.5))), 3);
  });
  it("NH4 0.5 mg/l at pH 8.2, 25°C → NH3 CRITICAL (toxic)", () => {
    const nh3 = nh3FromNh4(0.5, 8.2, 25);
    expect(nh3).toBeGreaterThan(NH3_CRITICAL_MG_L);
    // 0.5 × fraction ≈ 0.041 mg/l — clearly above the 0.02 critical threshold
    expect(nh3).toBeGreaterThan(0.04);
  });
  it("higher temperature shifts equilibrium toward NH3", () => {
    expect(nh3FromNh4(1, 7.5, 28)).toBeGreaterThan(nh3FromNh4(1, 7.5, 20));
  });
});

describe("evaluateWaterTest", () => {
  const ctx = { tankState: "established" as const };

  it("pH 8.2 + NH4 0.5 → NH3 critical (raw NH4 band alone would say ok)", () => {
    const res = evaluateWaterTest(
      { ph: 8.2, temp: 25, nh4: 0.5 },
      FRESHWATER_RANGES,
      { ...ctx, ph: 8.2, temp: 25 },
    );
    const nh3 = res.find((r) => r.key === "nh3");
    expect(nh3).toBeDefined();
    expect(nh3!.status).toBe("critical");
  });

  it("cycling tank demotes NO2 critical → warn (R1 tolerance)", () => {
    const established = evaluateWaterTest({ no2: 0.5 }, FRESHWATER_RANGES, { tankState: "established" });
    const cycling = evaluateWaterTest({ no2: 0.5 }, FRESHWATER_RANGES, { tankState: "cycling" });
    expect(established.find((r) => r.key === "no2")!.status).toBe("critical");
    expect(cycling.find((r) => r.key === "no2")!.status).toBe("warn");
  });

  it("missing values are skipped, not evaluated", () => {
    const res = evaluateWaterTest({ temp: 25 }, FRESHWATER_RANGES, ctx);
    expect(res).toHaveLength(1);
    expect(res[0].key).toBe("temp");
    expect(res[0].status).toBe("ok");
  });

  it("nitrate 60 → warn zone above target band", () => {
    const res = evaluateWaterTest({ no3: 60 }, FRESHWATER_RANGES, ctx);
    const no3 = res.find((r) => r.key === "no3");
    expect(no3!.status).toBe("critical"); // 60 > warnMax 50
  });
});
