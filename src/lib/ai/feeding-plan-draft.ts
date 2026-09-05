/**
 * draft_feeding_plan — the "suggest a feeding plan" button on the tank page
 * (docs/plan-fuetterungsplan.md).
 *
 * Same single-call pattern as the product import: the tank's coach context
 * (livestock, inventory incl. foods and their usual doses, water values) +
 * exactly one tool, strict zod validation — reject, never repair. The draft
 * lands in the EDITOR and nothing is saved until the user presses Save; the
 * manual save is the approval gate, exactly like the inventory import.
 *
 * It shares the coach's two-tier daily budget (purpose 'feeding_plan_draft'
 * counts into aiCalls like every other call) and never sees tanks other than
 * the requested one — buildCoachContext scopes it.
 */

import Anthropic from "@anthropic-ai/sdk";
import { getAiConfig, providerLabel, REQUEST_TIMEOUT_MS, estimateCostMicros } from "./config";
import { resolveSystemPrompt } from "./prompts";
import { logAiCall } from "./debug-log";
import { checkBudget, recordAiCall } from "./cost-guard";
import { buildCoachContext } from "./context";
import { getTank, listProducts } from "@/lib/repo";
import type { Product } from "@/lib/db/schema";
import { FEEDING_PLAN_MAX_CHARS } from "@/lib/schemas";
import { z } from "zod";
import type { ErrorCode } from "@/lib/domain/errors";
import type { Locale } from "@/i18n/locales";

/** Kept below the field cap so an over-eager model still fits after trimming. */
const PROMPTED_MAX_CHARS = 3500;

const TOOL_NAME = "draft_feeding_plan";
export const FEEDING_PLAN_TOOL_NAME = TOOL_NAME;
export const FEEDING_PLAN_TOOL_SCHEMA = {
  type: "object" as const,
  properties: {
    plan: { type: "string", description: `Complete feeding-plan markdown, max ${PROMPTED_MAX_CHARS} chars` },
  },
  required: ["plan"],
};

/** Same GLM trap as product-draft.ts: z.ai bills a thinking block against max_tokens. */
const MAX_OUTPUT_TOKENS_DEFAULT = 900;
const MAX_OUTPUT_TOKENS_ZAI = 4096;
const TEMPERATURE = 0.3;

export type FeedingPlanDraftResult = { ok: true; plan: string } | { ok: false; code: ErrorCode };

const toolOutputSchema = z.object({ plan: z.string().trim().min(1) });

/**
 * Over-cap output is cut at the last blank line so a table or list survives
 * whole — a hard slice mid-table would render a broken grid in the editor.
 */
export function fitToField(plan: string): string {
  if (plan.length <= FEEDING_PLAN_MAX_CHARS) return plan;
  const head = plan.slice(0, FEEDING_PLAN_MAX_CHARS);
  const cut = head.lastIndexOf("\n\n");
  return (cut > FEEDING_PLAN_MAX_CHARS * 0.5 ? head.slice(0, cut) : head).trim();
}

/**
 * The shelf's foods, verbatim — the one list a feeding plan may name (owner
 * report 2026-09-05: the coach wrote "Granulat" and the user could not map
 * that to any bottle on the shelf). Pure so a test can pin the contract.
 */
export function foodsDirective(foods: Product[]): string {
  if (foods.length === 0) {
    return "FOODS ON THE SHELF: none — the inventory has no foods at all. Describe food TYPES generically and say plainly that the shelf is empty, so the plan says what to BUY, not what to pour.";
  }
  const lines = foods.map((f) => `- "${f.name}"${f.defaultDose ? ` (usual dose ${f.defaultDose})` : ""}`);
  return `FOODS ON THE SHELF (the ONLY foods the plan may name — use these EXACT names, verbatim, never a generic word like "flakes" or "granulate" where one of these fits):
${lines.join("\n")}
If a feeding day needs something none of these covers, keep that day generic AND add a note saying the shelf has nothing suitable for it.`;
}

export async function draftFeedingPlan(params: {
  tankId: number;
  locale: Locale;
  now?: Date;
}): Promise<FeedingPlanDraftResult> {
  const now = params.now ?? new Date();

  const tank = getTank(params.tankId);
  if (!tank) return { ok: false, code: "feedingPlan.tankNotFound" };

  const config = getAiConfig();
  if (!config) return { ok: false, code: "feedingPlan.aiOffline" };

  const budget = checkBudget(config, now);
  if (!budget.allowed) return { ok: false, code: "feedingPlan.limitReached" };

  const context = buildCoachContext(now, undefined, params.tankId);
  const foods = listProducts("food");

  const startedAt = Date.now();
  let requestBody: Anthropic.Messages.MessageCreateParamsNonStreaming | null = null;
  try {
    const client = new Anthropic({ apiKey: config.apiKey, baseURL: config.baseUrl, timeout: REQUEST_TIMEOUT_MS });
    const isZai = providerLabel(config.baseUrl) === "zai";

    requestBody = {
      model: config.model,
      max_tokens: isZai ? MAX_OUTPUT_TOKENS_ZAI : MAX_OUTPUT_TOKENS_DEFAULT,
      temperature: TEMPERATURE,
      ...(isZai ? { thinking: { type: "disabled" as const } } : {}),
      system: resolveSystemPrompt("feedingPlanDraft", params.locale),
      messages: [
        {
          role: "user",
          content: `Draft the feeding plan for this tank.\n\n${foodsDirective(foods)}\n\n=== TANK CONTEXT ===\n${context}`,
        },
      ],
      tools: [
        {
          name: FEEDING_PLAN_TOOL_NAME,
          description: "Return the complete feeding-plan markdown for the tank page",
          input_schema: FEEDING_PLAN_TOOL_SCHEMA,
        },
      ],
    };

    const response = await client.messages.create(requestBody);

    logAiCall({
      purpose: "feeding_plan_draft",
      provider: providerLabel(config.baseUrl),
      model: config.model,
      request: requestBody,
      response: { content: response.content, usage: response.usage },
      error: null,
      durationMs: Date.now() - startedAt,
    });

    recordAiCall({
      provider: providerLabel(config.baseUrl),
      model: config.model,
      purpose: "feeding_plan_draft",
      promptTokens: response.usage?.input_tokens ?? 0,
      completionTokens: response.usage?.output_tokens ?? 0,
      costEstimateMicros: estimateCostMicros(config.model, response.usage?.input_tokens ?? 0, response.usage?.output_tokens ?? 0),
      now,
    });

    let raw: Record<string, unknown> | null = null;
    for (const block of response.content) {
      if (block.type === "tool_use" && block.name === TOOL_NAME) {
        raw = block.input as Record<string, unknown>;
        break;
      }
    }
    // No tool call is the model's way of saying it cannot ground a plan.
    if (!raw) return { ok: false, code: "feedingPlan.draftFailed" };

    const parsed = toolOutputSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, code: "feedingPlan.draftFailed" };

    return { ok: true, plan: fitToField(parsed.data.plan) };
  } catch (err) {
    console.error("[feedingPlanDraft]", err);
    if (requestBody) {
      logAiCall({
        purpose: "feeding_plan_draft",
        provider: providerLabel(config.baseUrl),
        model: config.model,
        request: requestBody,
        response: null,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startedAt,
      });
    }
    return { ok: false, code: "feedingPlan.aiOffline" };
  }
}
