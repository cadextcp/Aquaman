/**
 * Fertilize plan ↔ inventory comparison (docs/plan-produkt-lager.md §5).
 *
 * A fertilize plan doses nutrients (`detailData.nutrients`), a fertilizer
 * product declares which nutrients it contains — both keyed by NUTRIENTS from
 * plan-structure.ts. That shared vocabulary is the whole mechanism: the
 * comparison is a key comparison, nothing is parsed or converted.
 *
 * What this deliberately does NOT do: arithmetic. A plan's dose is free text
 * ("10 ml") and a product's content is free text ("0.2 %"), so computing mg/l
 * in the tank would be guessing dressed up as a number. The question answered
 * here is "do I own anything that delivers this?" — not "how much lands in the
 * water?". Both texts are carried through for display, never for maths.
 *
 * Pure and DB-free like the rest of domain/: the UI and the coach context call
 * the same function, so they can never disagree about what is covered.
 */

export type InventoryProduct = {
  id: number;
  name: string;
  /** nutrient key → declared content ("0.2 %"); "" means contained, no content given */
  nutrients: Record<string, string>;
};

export type NutrientMatch = {
  /** nutrient key from NUTRIENTS */
  key: string;
  /** what the plan doses, verbatim ("10 ml") */
  dose: string;
  /** products that contain it — empty exactly when this is an uncovered nutrient */
  providedBy: { id: number; name: string; content: string }[];
};

export type UnusedProduct = {
  id: number;
  name: string;
  /** the nutrient keys it carries — may be empty for a product with none recorded */
  keys: string[];
};

export type PlanCoverage = {
  /** plan doses it, the shelf delivers it */
  covered: NutrientMatch[];
  /** plan doses it, NOTHING on the shelf contains it — the finding worth surfacing */
  uncovered: NutrientMatch[];
  /** on the shelf, dosed by no plan passed in */
  unusedProducts: UnusedProduct[];
};

/** A nutrient entry counts as dosed unless the plan left it blank. */
function dosedKeys(planNutrients: Record<string, unknown> | null | undefined): [string, string][] {
  if (!planNutrients || typeof planNutrients !== "object") return [];
  return Object.entries(planNutrients)
    .map(([key, dose]) => [key, typeof dose === "string" ? dose.trim() : String(dose ?? "").trim()] as [string, string])
    .filter(([, dose]) => dose !== "");
}

/**
 * Compares one or more fertilize plans against the fertilizer shelf.
 *
 * Takes a LIST of plans, not one: "which product is unused?" is only
 * answerable across every plan that could be dosing it — asked per plan, a
 * product used by the second tank would be reported as unused by the first.
 */
export function coverFertilizePlans(
  plans: (Record<string, unknown> | null | undefined)[],
  products: InventoryProduct[],
): PlanCoverage {
  // Dose per nutrient across all plans; the first plan naming it wins the
  // string, since this is a label, not a total (two plans dosing K "5 ml"
  // each do not add up to 10 ml in any meaningful sense).
  const doses = new Map<string, string>();
  for (const plan of plans) {
    for (const [key, dose] of dosedKeys(plan)) if (!doses.has(key)) doses.set(key, dose);
  }

  const covered: NutrientMatch[] = [];
  const uncovered: NutrientMatch[] = [];
  const usedProductIds = new Set<number>();

  for (const [key, dose] of doses) {
    const providedBy = products
      .filter((p) => key in (p.nutrients ?? {}))
      .map((p) => ({ id: p.id, name: p.name, content: p.nutrients[key] ?? "" }));
    for (const p of providedBy) usedProductIds.add(p.id);
    (providedBy.length > 0 ? covered : uncovered).push({ key, dose, providedBy });
  }

  const unusedProducts = products
    .filter((p) => !usedProductIds.has(p.id))
    .map((p) => ({ id: p.id, name: p.name, keys: Object.keys(p.nutrients ?? {}) }));

  return { covered, uncovered, unusedProducts };
}

/** One plan against the shelf — `unusedProducts` then means "not dosed by THIS plan". */
export function coverFertilizePlan(
  planNutrients: Record<string, unknown> | null | undefined,
  products: InventoryProduct[],
): PlanCoverage {
  return coverFertilizePlans([planNutrients], products);
}

/**
 * How many of the given plans dose at least one nutrient this product carries
 * — what /inventory shows as "used in N plans".
 */
export function plansUsingProduct(
  product: InventoryProduct,
  plans: (Record<string, unknown> | null | undefined)[],
): number {
  const keys = Object.keys(product.nutrients ?? {});
  if (keys.length === 0) return 0;
  return plans.filter((plan) => dosedKeys(plan).some(([key]) => keys.includes(key))).length;
}
