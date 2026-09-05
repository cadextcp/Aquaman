/**
 * Draft normalisation (src/lib/ai/product-draft.ts).
 *
 * The provider call itself is covered by the route test and by live evals; what
 * is pinned here is everything that decides whether a model answer is allowed
 * to reach a person's form — the length handling and the nutrient filter.
 */
import { describe, it, expect } from "vitest";
import { clipText, pickNutrients } from "../src/lib/ai/product-draft";
import { NUTRIENT_KEYS } from "../src/lib/domain/plan-structure";

describe("clipText", () => {
  it("passes short values through untouched", () => {
    expect(clipText("sera Flora Nature", 80)).toBe("sera Flora Nature");
  });

  it("trims and treats blank as absent", () => {
    expect(clipText("  1-2x daily  ", 30)).toBe("1-2x daily");
    expect(clipText("   ", 30)).toBeNull();
    expect(clipText(undefined, 30)).toBeNull();
    expect(clipText(42, 30)).toBeNull();
  });

  // The first live run produced exactly 600 characters ending mid-word:
  // "…cod liver oil (34 % omega f". A stump like that in the user's form is
  // the difference between a draft and a mess.
  it("never ends mid-word", () => {
    const long = `${"Analysis: protein 45 percent and fat 7.9 percent. ".repeat(12)}cod liver oil with omega fatty acids`;
    const clipped = clipText(long, 600)!;
    expect(clipped.length).toBeLessThanOrEqual(600);
    expect(clipped).not.toMatch(/\s\S{1,2}$/);
    expect(long.startsWith(clipped.replace(/\.$/, "").trim().slice(0, 40))).toBe(true);
  });

  it("prefers a sentence end over a word end", () => {
    const text = `${"x".repeat(400)}. ${"y".repeat(400)}`;
    expect(clipText(text, 600)).toBe(`${"x".repeat(400)}.`);
  });

  it("falls back to a hard cut when no boundary is late enough", () => {
    const noSpaces = "z".repeat(700);
    expect(clipText(noSpaces, 600)).toHaveLength(600);
  });
});

describe("pickNutrients", () => {
  it("keeps catalogue keys with their declared content", () => {
    expect(pickNutrients({ n_no3: "0,02 %", k: "0,11 % K2O", fe: "" }, "fertilizer")).toEqual({
      n_no3: "0,02 %",
      k: "0,11 % K2O",
      fe: "",
    });
  });

  // Sulphur and cobalt are on real labels but deliberately NOT in the
  // catalogue (owner decision) — they belong in the description instead.
  it("drops keys the app does not track", () => {
    expect(pickNutrients({ fe: "0,025 %", s: "0,14 %", co: "0,0001 %", nonsense: "x" }, "fertilizer")).toEqual({
      fe: "0,025 %",
    });
  });

  it("returns nothing at all for a food", () => {
    expect(pickNutrients({ fe: "0,025 %" }, "food")).toEqual({});
  });

  it("survives a non-object and coerces odd values", () => {
    expect(pickNutrients(null, "fertilizer")).toEqual({});
    expect(pickNutrients("nope", "fertilizer")).toEqual({});
    expect(pickNutrients({ fe: 12 }, "fertilizer")).toEqual({ fe: "" });
  });

  it("caps a content string at the column's limit", () => {
    const long = pickNutrients({ fe: "x".repeat(80) }, "fertilizer");
    expect(long.fe).toHaveLength(30);
  });

  it("accepts every key the catalogue defines", () => {
    const all = Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, "1 %"]));
    expect(Object.keys(pickNutrients(all, "fertilizer"))).toHaveLength(NUTRIENT_KEYS.length);
  });
});
