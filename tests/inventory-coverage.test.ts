/**
 * Fertilize plan ↔ inventory comparison (src/lib/domain/inventory.ts).
 *
 * Pure logic, no DB — the same function feeds the plan card and the coach
 * context, so the interesting cases are the ones a wrong answer would make
 * the coach state confidently: a gap reported as covered, or a product
 * called unused while a plan does dose it.
 */
import { describe, it, expect } from "vitest";
import { coverFertilizePlan, coverFertilizePlans, plansUsingProduct } from "../src/lib/domain/inventory";

const ferro = { id: 1, name: "Easy Life Ferro", nutrients: { fe: "0.2 %" } };
const npk = { id: 2, name: "Makro Basic NPK", nutrients: { n_no3: "", p_po4: "", k: "5 %" } };
const empty = { id: 3, name: "Unlabelled bottle", nutrients: {} };

describe("coverFertilizePlan", () => {
  it("splits a plan's nutrients into covered and uncovered", () => {
    const res = coverFertilizePlan({ nutrients: { fe: "10 ml", k: "5 ml", mg: "3 ml" } }.nutrients, [ferro, npk]);

    expect(res.covered.map((c) => c.key).sort()).toEqual(["fe", "k"]);
    expect(res.uncovered.map((c) => c.key)).toEqual(["mg"]);
    // the uncovered entry still carries the dose, so the UI can say what is missing
    expect(res.uncovered[0].dose).toBe("3 ml");
  });

  it("names which product delivers a nutrient, with its declared content", () => {
    const res = coverFertilizePlan({ fe: "10 ml" }, [ferro, npk]);
    expect(res.covered[0].providedBy).toEqual([{ id: 1, name: "Easy Life Ferro", content: "0.2 %" }]);
  });

  it("a nutrient in two products lists both", () => {
    const second = { id: 4, name: "Other iron", nutrients: { fe: "" } };
    const res = coverFertilizePlan({ fe: "10 ml" }, [ferro, second]);
    expect(res.covered[0].providedBy.map((p) => p.name)).toEqual(["Easy Life Ferro", "Other iron"]);
  });

  it("an empty content still counts as covered — the tick is the claim, not the number", () => {
    const res = coverFertilizePlan({ k: "5 ml" }, [npk]);
    expect(res.uncovered).toHaveLength(0);
    expect(res.covered[0].providedBy[0].content).toBe("5 %");
    const noContent = coverFertilizePlan({ n_no3: "2 ml" }, [npk]);
    expect(noContent.covered[0].providedBy[0].content).toBe("");
  });

  it("ignores nutrients the plan left blank — an empty dose is not a dose", () => {
    const res = coverFertilizePlan({ fe: "10 ml", k: "", mg: "   " }, [ferro]);
    expect(res.covered.map((c) => c.key)).toEqual(["fe"]);
    expect(res.uncovered).toHaveLength(0);
  });

  it("empty plan: nothing covered, nothing missing, everything unused", () => {
    for (const plan of [null, undefined, {}]) {
      const res = coverFertilizePlan(plan, [ferro, npk]);
      expect(res.covered).toHaveLength(0);
      expect(res.uncovered).toHaveLength(0);
      expect(res.unusedProducts.map((p) => p.id).sort()).toEqual([1, 2]);
    }
  });

  it("empty shelf: every dosed nutrient is a gap", () => {
    const res = coverFertilizePlan({ fe: "10 ml", k: "5 ml" }, []);
    expect(res.covered).toHaveLength(0);
    expect(res.uncovered.map((c) => c.key).sort()).toEqual(["fe", "k"]);
  });

  it("a product with no nutrients recorded is always unused — it claims nothing", () => {
    const res = coverFertilizePlan({ fe: "10 ml" }, [ferro, empty]);
    expect(res.unusedProducts.map((p) => p.name)).toEqual(["Unlabelled bottle"]);
    expect(res.unusedProducts[0].keys).toEqual([]);
  });
});

describe("coverFertilizePlans across several plans", () => {
  it("a product dosed by the SECOND plan is not reported as unused", () => {
    // asked per plan this would be wrong: plan A alone would call NPK unused
    const res = coverFertilizePlans([{ fe: "10 ml" }, { k: "5 ml" }], [ferro, npk]);
    expect(res.unusedProducts).toHaveLength(0);
    expect(res.covered.map((c) => c.key).sort()).toEqual(["fe", "k"]);
  });

  it("keeps the first dose it sees for a nutrient two plans both dose", () => {
    const res = coverFertilizePlans([{ fe: "10 ml" }, { fe: "4 ml" }], [ferro]);
    expect(res.covered).toHaveLength(1);
    expect(res.covered[0].dose).toBe("10 ml");
  });

  it("tolerates a null plan in the list (a plan with no structured details)", () => {
    const res = coverFertilizePlans([null, { fe: "10 ml" }], [ferro]);
    expect(res.covered.map((c) => c.key)).toEqual(["fe"]);
  });
});

describe("plansUsingProduct", () => {
  it("counts the plans dosing anything the product carries", () => {
    expect(plansUsingProduct(npk, [{ k: "5 ml" }, { fe: "10 ml" }, { n_no3: "2 ml" }])).toBe(2);
  });

  it("is 0 for a product with no nutrients, however many plans there are", () => {
    expect(plansUsingProduct(empty, [{ fe: "10 ml" }, { k: "5 ml" }])).toBe(0);
  });

  it("does not count a plan that names the nutrient with a blank dose", () => {
    expect(plansUsingProduct(ferro, [{ fe: "" }])).toBe(0);
  });
});
