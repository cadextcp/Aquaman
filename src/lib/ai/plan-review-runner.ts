/**
 * The AI part of the plan review — isolated so tests can import plan-review.ts
 * without touching the SDK (and vice versa). Single call, tool-use enforced,
 * zod-validated, counted against the daily budget (purpose 'plan_review').
 */

import Anthropic from "@anthropic-ai/sdk";
import { getAiConfig, providerLabel, estimateCostMicros, REQUEST_TIMEOUT_MS } from "./config";
import { recordAiCall } from "./cost-guard";
import { buildCoachContext } from "./context";
import { resolveSystemPrompt } from "./prompts";
import { getLocale } from "../settings";
import { listSchedules } from "@/lib/repo";
import { planReviewResultSchema } from "./plan-review";
import { logAiCall } from "./debug-log";

export const PLAN_REVIEW_TOOL_NAME = "plan_review_result";
export const PLAN_REVIEW_TOOL_SCHEMA = {
  type: "object" as const,
  properties: {
    shouldChange: { type: "boolean", description: "true only if the plan actually needs adjustment" },
    summary: { type: "string", description: "One sentence: why (or why not)" },
    prompts: {
      type: "array",
      description: "0–3 clickable follow-up prompts (empty when shouldChange=false)",
      items: {
        type: "object",
        properties: {
          label: { type: "string", description: "Short chip label (≤60 chars)" },
          prompt: { type: "string", description: "Full self-contained question for the coach" },
        },
        required: ["label", "prompt"],
      },
    },
  },
  required: ["shouldChange", "summary", "prompts"],
};

export async function executePlanReview(
  reason: "tank_change" | "water_test",
): Promise<{ shouldChange: boolean; summary: string; prompts: { label: string; prompt: string }[] } | null> {
  const config = getAiConfig();
  if (!config) return null;

  const client = new Anthropic({ apiKey: config.apiKey, baseURL: config.baseUrl, timeout: REQUEST_TIMEOUT_MS });
  const context = buildCoachContext();
  const planTypes = [...new Set(listSchedules().map((s) => s.actionType))];
  const system = resolveSystemPrompt("planReview", getLocale(), { context, planTypes });

  const requestBody = {
    model: config.model,
    max_tokens: 600,
    system,
    messages: [{ role: "user" as const, content: `Trigger: ${reason}. Review the care plan now.` }],
    tools: [
      {
        name: PLAN_REVIEW_TOOL_NAME,
        description: "Return the plan review verdict",
        input_schema: PLAN_REVIEW_TOOL_SCHEMA,
      },
    ],
    tool_choice: { type: "tool" as const, name: PLAN_REVIEW_TOOL_NAME },
  };

  const startedAt = Date.now();
  let response: Anthropic.Messages.Message;
  try {
    response = await client.messages.create(requestBody);
  } catch (err) {
    logAiCall({
      purpose: "plan_review",
      provider: providerLabel(config.baseUrl),
      model: config.model,
      request: requestBody,
      response: null,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startedAt,
    });
    throw err;
  }

  logAiCall({
    purpose: "plan_review",
    provider: providerLabel(config.baseUrl),
    model: config.model,
    request: requestBody,
    response: { content: response.content, usage: response.usage },
    error: null,
    durationMs: Date.now() - startedAt,
  });

  // count against the budget regardless of outcome
  recordAiCall({
    provider: providerLabel(config.baseUrl),
    model: config.model,
    purpose: "plan_review",
    promptTokens: response.usage?.input_tokens ?? 0,
    completionTokens: response.usage?.output_tokens ?? 0,
    costEstimateMicros: estimateCostMicros(
      config.model,
      response.usage?.input_tokens ?? 0,
      response.usage?.output_tokens ?? 0,
    ),
  });

  let raw: unknown = null;
  for (const block of response.content) {
    if (block.type === "tool_use" && block.name === PLAN_REVIEW_TOOL_NAME) {
      raw = block.input;
      break;
    }
  }
  if (raw === null) return null; // malformed → reject, never repair

  const parsed = planReviewResultSchema.safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data;
}
