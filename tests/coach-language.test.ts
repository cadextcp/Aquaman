/**
 * The coach answers in the app's language (Phase 5 of the i18n work).
 *
 * The failure this pins: the system prompt used to say "answer in the user's
 * language", which made the MODEL guess from the question — a German question
 * in an English app got a German answer and vice versa. The setting decides.
 */
import { describe, it, expect } from "vitest";
import { languageDirective, withLanguage } from "../src/lib/ai/language";
import { LOCALES } from "../src/i18n/locales";

describe("coach language directive", () => {
  it("names the target language for every locale the app offers", () => {
    for (const loc of LOCALES) {
      const d = languageDirective(loc);
      expect(d).toContain("LANGUAGE");
      expect(d.length).toBeGreaterThan(200);
    }
    expect(languageDirective("de")).toContain("German");
    expect(languageDirective("de")).toContain("Deutsch");
    expect(languageDirective("en")).toContain("English");
    expect(languageDirective("de")).not.toContain("Deutsch (Deutsch");
  });

  it("overrides the question's own language, not just the default", () => {
    expect(languageDirective("de")).toMatch(/EVEN IF the user writes in another language/i);
  });

  it("protects the identifiers the app matches on", () => {
    // a translated actionType would fail zod in the proposal gate
    expect(languageDirective("de")).toContain("water_change");
  });

  it("appends to a system prompt without discarding it", () => {
    const system = withLanguage("BASE PROMPT", "de");
    expect(system.startsWith("BASE PROMPT")).toBe(true);
    expect(system).toContain("German");
  });

  it("the coach prompt no longer carries the old guess-the-language line", async () => {
    const { COACH_SYSTEM_PROMPT } = await import("../src/lib/ai/context");
    expect(COACH_SYSTEM_PROMPT).not.toMatch(/answer in the user's language/i);
  });
});
