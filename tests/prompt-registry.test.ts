/**
 * The prompt registry (docs/plan-prompt-anpassung.md): defaults, placeholder
 * substitution, the ALWAYS-appended guardrails + language directive, and the
 * save gate (whitelist + required {{context}}). These are the contracts the
 * editor UI and every AI call site lean on — a silent change here changes
 * every coach answer.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

const TMP = path.join(tmpdir(), `aquaman-prompt-registry-${Date.now()}`);
process.env.AQUAMAN_DATA_DIR = TMP;

beforeAll(async () => {
  mkdirSync(TMP, { recursive: true });
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const { db } = await import("../src/lib/db");
  migrate(db, { migrationsFolder: "./drizzle" });
});

afterAll(async () => {
  const { closeDb } = await import("./helpers");
  closeDb();
  rmSync(TMP, { recursive: true, force: true });
});

describe("prompt registry defaults", () => {
  it("defaults carry the context marker where the prompt is context-bound", async () => {
    const { promptDefault } = await import("../src/lib/ai/prompts");
    expect(promptDefault("coach")).toContain("{{context}}");
    expect(promptDefault("suggestions")).toContain("{{context}}");
    expect(promptDefault("planReview")).toContain("{{context}}");
    // the draft prompt is pure instruction — data goes to the USER message
    expect(promptDefault("feedingPlanDraft")).not.toContain("{{");
  });

  it("the plan-review default keeps the fishless guard the source-pin test checks", async () => {
    const { promptDefault } = await import("../src/lib/ai/prompts");
    expect(promptDefault("planReview")).toMatch(/fish:\s*"?NONE"?/);
    expect(promptDefault("planReview")).toMatch(/NEVER propose feeding/i);
  });

  it("coach default contains the live COACH_SYSTEM_PROMPT unchanged", async () => {
    const { promptDefault } = await import("../src/lib/ai/prompts");
    const { COACH_SYSTEM_PROMPT } = await import("../src/lib/ai/context");
    expect(promptDefault("coach").startsWith(COACH_SYSTEM_PROMPT)).toBe(true);
  });
});

describe("validatePromptText (the save gate)", () => {
  it("accepts each default as-is", async () => {
    const { validatePromptText, promptDefault, PROMPT_IDS } = await import("../src/lib/ai/prompts");
    for (const id of PROMPT_IDS) {
      expect(validatePromptText(id, promptDefault(id))).toEqual({ ok: true });
    }
  });

  it("rejects an unknown placeholder with the allowed list in the error", async () => {
    const { validatePromptText } = await import("../src/lib/ai/prompts");
    const res = validatePromptText("coach", "Be terse.\n\n{{context}}\n{{kontext}}");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("{{kontext}}");
  });

  it("rejects a context-bound prompt without {{context}} — a context-free coach fabricates", async () => {
    const { validatePromptText } = await import("../src/lib/ai/prompts");
    for (const id of ["coach", "suggestions", "planReview"] as const) {
      const res = validatePromptText(id, "Answer everything from memory.");
      expect(res.ok, id).toBe(false);
      if (!res.ok) expect(res.error).toContain("{{context}} is required");
    }
  });

  it("rejects empty and over-cap text", async () => {
    const { validatePromptText, PROMPT_MAX_CHARS, promptDefault } = await import("../src/lib/ai/prompts");
    expect(validatePromptText("coach", "   ").ok).toBe(false);
    const padded = promptDefault("coach") + "\n" + "x".repeat(PROMPT_MAX_CHARS);
    expect(validatePromptText("coach", padded).ok).toBe(false);
  });
});

describe("resolveSystemPrompt / composePromptText", () => {
  it("substitutes {{context}} and {{plan_types}}, deduping plan types", async () => {
    const { composePromptText } = await import("../src/lib/ai/prompts");
    const out = composePromptText(
      "RULES\n\n{{context}}\n\n{{plan_types}}",
      "en",
      { context: "TANK #1 …", planTypes: ["water_change", "water_change", "fertilize"] },
    );
    expect(out).toContain("RULES");
    expect(out).toContain("TANK #1 …");
    expect(out).toContain("EXISTING PLAN TYPES: water_change, fertilize");
  });

  it("an omitted optional placeholder takes its hint line with it", async () => {
    const { composePromptText } = await import("../src/lib/ai/prompts");
    const out = composePromptText("RULES\n\n{{context}}", "en", { context: "CTX", planTypes: ["water_change"] });
    expect(out).not.toContain("EXISTING PLAN TYPES");
  });

  it("guardrails and the language directive are ALWAYS appended — default or override", async () => {
    const { resolveSystemPrompt, GUARDRAILS } = await import("../src/lib/ai/prompts");
    for (const id of ["coach", "suggestions", "planReview", "feedingPlanDraft"] as const) {
      const out = resolveSystemPrompt(id, "de", { context: "CTX" });
      expect(out, id).toContain(GUARDRAILS);
      expect(out, id).toContain("LANGUAGE (highest priority");
    }
  });

  it("an override replaces the default; removing it restores the default", async () => {
    const { savePromptOverride, resolveSystemPrompt, promptDefault } = await import("../src/lib/ai/prompts");
    const custom = `Sei ein Piraten-Kapitän, aber fachlich korrekt.\n\n{{context}}`;
    savePromptOverride("coach", custom);
    const resolved = resolveSystemPrompt("coach", "en", { context: "CTX" });
    expect(resolved).toContain("Piraten-Kapitän");
    expect(resolved).not.toContain(promptDefault("coach").slice(0, 40));

    savePromptOverride("coach", null);
    // the placeholder is substituted in the resolved output, so compare the
    // part BEFORE the marker — the default's head — and the pirate must be gone
    const restored = resolveSystemPrompt("coach", "en", { context: "CTX" });
    expect(restored.startsWith(promptDefault("coach").split("{{context}}")[0])).toBe(true);
    expect(restored).not.toContain("Piraten-Kapitän");
  });
});
