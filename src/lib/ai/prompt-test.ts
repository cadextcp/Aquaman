/**
 * The engine behind POST /api/more/prompts/test (docs/plan-prompt-anpassung
 * §5): run an — possibly UNSAVED — prompt through the real provider once and
 * return the result as INERT DATA.
 *
 * What makes this a test and not a backdoor: none of the real paths' side
 * effects run here. No chip cache is written (saveDailySuggestions stays in
 * suggestions.ts), no plan-review banner is set, no editor is filled, no
 * proposal becomes applicable — the payload the caller renders read-only is
 * the only output. The one AI write path of the app (applyProposal) needs a
 * user click the test panel never renders.
 *
 * Real costs, honestly counted: purpose 'prompt_test', inside the shared
 * two-tier daily budget like every other call.
 */

import Anthropic from "@anthropic-ai/sdk";
import { getAiConfig, providerLabel, REQUEST_TIMEOUT_MS, estimateCostMicros } from "./config";
import { checkBudget, recordAiCall } from "./cost-guard";
import { buildCoachContext } from "./context";
import { listSchedules, listProducts } from "@/lib/repo";
import { logAiCall } from "./debug-log";
import {
  composePromptText,
  validatePromptText,
  type PromptId,
  type PromptValues,
} from "./prompts";
import {
  PROPOSAL_TOOL_NAME,
  PROPOSAL_TOOL_DESCRIPTION,
  PROPOSAL_TOOL_INPUT_SCHEMA,
  parseProposal,
} from "./proposal";
import { SUGGESTIONS_TOOL_NAME, SUGGESTIONS_TOOL_SCHEMA } from "./suggestions";
import { parseSuggestions } from "./proposal";
import { PLAN_REVIEW_TOOL_NAME, PLAN_REVIEW_TOOL_SCHEMA } from "./plan-review-runner";
import { planReviewResultSchema } from "./plan-review";
import { FEEDING_PLAN_TOOL_NAME, FEEDING_PLAN_TOOL_SCHEMA, foodsDirective, fitToField } from "./feeding-plan-draft";
import { getLocale } from "../settings";
import type { ErrorCode } from "@/lib/domain/errors";
import type { Locale } from "@/i18n/locales";

export type PromptTestUsage = { promptTokens: number; completionTokens: number; costEstimateMicros: number };

export type PromptTestResult =
  | ({ ok: true; usage: PromptTestUsage } & (
      | { kind: "coach"; answer: string; proposal: unknown | null }
      | { kind: "suggestions"; items: { label: string; prompt: string }[] }
      | { kind: "planReview"; verdict: { shouldChange: boolean; summary: string; prompts: { label: string; prompt: string }[] } }
      | { kind: "feedingPlanDraft"; plan: string }
    ))
  | { ok: false; code: ErrorCode };

/** Output budgets mirror each real path so a test predicts the real call. */
const MAX_TOKENS: Record<PromptId, { default: number; zai: number }> = {
  coach: { default: 1024, zai: 4096 },
  suggestions: { default: 700, zai: 4096 },
  planReview: { default: 600, zai: 4096 },
  feedingPlanDraft: { default: 900, zai: 4096 },
};

export async function runPromptTest(params: {
  promptId: PromptId;
  system: string;
  question?: string;
  locale?: Locale;
  now?: Date;
}): Promise<PromptTestResult> {
  const now = params.now ?? new Date();
  const locale = params.locale ?? getLocale();

  // The SAME gate saving uses — a test may only run what could be saved.
  const check = validatePromptText(params.promptId, params.system);
  if (!check.ok) return { ok: false, code: "prompt.invalid" };

  const config = getAiConfig();
  if (!config) return { ok: false, code: "prompt.aiOffline" };

  const budget = checkBudget(config, now);
  if (!budget.allowed) return { ok: false, code: "prompt.limitReached" };

  const context = buildCoachContext(now);
  const planTypes = [...new Set(listSchedules().map((s) => s.actionType))];
  const values: PromptValues = { context, planTypes };
  const isZai = providerLabel(config.baseUrl) === "zai";
  const maxTokens = isZai ? MAX_TOKENS[params.promptId].zai : MAX_TOKENS[params.promptId].default;

  const system = composePromptText(params.system, locale, values);

  let userContent: string;
  let tools: Anthropic.Messages.Tool[];
  let toolChoice: { type: "tool"; name: string } | undefined;
  switch (params.promptId) {
    case "coach":
      userContent = params.question?.trim() || "Give me one short tip for my tank.";
      tools = [
        {
          name: PROPOSAL_TOOL_NAME,
          description: PROPOSAL_TOOL_DESCRIPTION,
          input_schema: { ...PROPOSAL_TOOL_INPUT_SCHEMA, type: "object" },
        },
      ];
      break;
    case "suggestions":
      userContent = "Generate today's 5 suggestions.";
      tools = [{ name: SUGGESTIONS_TOOL_NAME, description: "Return the 5 daily suggestions", input_schema: { ...SUGGESTIONS_TOOL_SCHEMA, type: "object" } }];
      toolChoice = { type: "tool", name: SUGGESTIONS_TOOL_NAME };
      break;
    case "planReview":
      userContent = "Trigger: tank_change (prompt test). Review the care plan now.";
      tools = [{ name: PLAN_REVIEW_TOOL_NAME, description: "Return the plan review verdict", input_schema: { ...PLAN_REVIEW_TOOL_SCHEMA, type: "object" } }];
      toolChoice = { type: "tool", name: PLAN_REVIEW_TOOL_NAME };
      break;
    case "feedingPlanDraft":
      userContent = `Draft the feeding plan for this tank.\n\n${foodsDirective(listProducts("food"))}\n\n=== TANK CONTEXT ===\n${context}`;
      tools = [{ name: FEEDING_PLAN_TOOL_NAME, description: "Return the complete feeding-plan markdown for the tank page", input_schema: { ...FEEDING_PLAN_TOOL_SCHEMA, type: "object" } }];
      toolChoice = { type: "tool", name: FEEDING_PLAN_TOOL_NAME };
      break;
  }

  const startedAt = Date.now();
  let requestBody: Anthropic.Messages.MessageCreateParamsNonStreaming | null = null;
  try {
    const client = new Anthropic({ apiKey: config.apiKey, baseURL: config.baseUrl, timeout: REQUEST_TIMEOUT_MS });
    requestBody = {
      model: config.model,
      max_tokens: maxTokens,
      temperature: 0.3,
      ...(isZai ? { thinking: { type: "disabled" as const } } : {}),
      system,
      messages: [{ role: "user", content: userContent }],
      tools,
      ...(toolChoice ? { tool_choice: toolChoice } : {}),
    };

    const response = await client.messages.create(requestBody);

    logAiCall({
      purpose: "prompt_test",
      provider: providerLabel(config.baseUrl),
      model: config.model,
      request: requestBody,
      response: { content: response.content, usage: response.usage },
      error: null,
      durationMs: Date.now() - startedAt,
    });

    const usage: PromptTestUsage = {
      promptTokens: response.usage?.input_tokens ?? 0,
      completionTokens: response.usage?.output_tokens ?? 0,
      costEstimateMicros: estimateCostMicros(config.model, response.usage?.input_tokens ?? 0, response.usage?.output_tokens ?? 0),
    };

    recordAiCall({
      provider: providerLabel(config.baseUrl),
      model: config.model,
      purpose: "prompt_test",
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      costEstimateMicros: usage.costEstimateMicros,
      now,
    });

    // tool_use block (if the prompt uses one) + visible text, both inert
    let toolInput: Record<string, unknown> | null = null;
    let answer = "";
    for (const block of response.content) {
      if (block.type === "tool_use") toolInput = block.input as Record<string, unknown>;
      else if (block.type === "text") answer += block.text;
    }

    switch (params.promptId) {
      case "coach": {
        // parseProposal only to VERIFY shape; the payload stays raw JSON —
        // the panel never wires it into applyProposal.
        const proposal = toolInput ? parseProposal(toolInput) : null;
        return { ok: true, kind: "coach", answer: answer.trim(), proposal, usage };
      }
      case "suggestions": {
        const parsed = toolInput ? parseSuggestions({ day: "1970-01-01", items: toolInput.items }) : null;
        if (!parsed) return { ok: true, kind: "suggestions", items: [], usage }; // visible "no result", never a rescue
        return { ok: true, kind: "suggestions", items: parsed.items, usage };
      }
      case "planReview": {
        const parsed = toolInput ? planReviewResultSchema.safeParse(toolInput) : null;
        if (!parsed || !parsed.success) {
          return { ok: true, kind: "planReview", verdict: { shouldChange: false, summary: answer.trim() || "(no valid verdict)", prompts: [] }, usage };
        }
        return { ok: true, kind: "planReview", verdict: parsed.data, usage };
      }
      case "feedingPlanDraft": {
        const plan = typeof toolInput?.plan === "string" ? fitToField(toolInput.plan.trim()) : answer.trim();
        return { ok: true, kind: "feedingPlanDraft", plan, usage };
      }
    }
  } catch (err) {
    console.error("[promptTest]", err);
    if (requestBody) {
      logAiCall({
        purpose: "prompt_test",
        provider: providerLabel(config.baseUrl),
        model: config.model,
        request: requestBody,
        response: null,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startedAt,
      });
    }
    return { ok: false, code: "prompt.aiOffline" };
  }
}
