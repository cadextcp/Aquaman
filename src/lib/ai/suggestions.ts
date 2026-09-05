/**
 * Daily suggestion generation (issue #41): one AI call per local day that
 * produces 5 context-aware clickable prompts ("Suggest a fertilization
 * plan" when none exists, …). The results are cached in appSettings; the
 * UI never triggers a second call for the same day.
 *
 * Single-call pattern (no agent loop): system prompt + coach context, one
 * tool_use (daily_suggestions), strict zod validation — reject, never repair.
 */

import Anthropic from "@anthropic-ai/sdk";
import { getAiConfig, providerLabel, REQUEST_TIMEOUT_MS } from "./config";
import { buildCoachContext } from "./context";
import { resolveSystemPrompt } from "./prompts";
import { getLocale } from "../settings";
import { parseSuggestions } from "./proposal";
import { getDailySuggestions, saveDailySuggestions } from "../settings";
import { listSchedules } from "@/lib/repo";
import { logAiCall } from "./debug-log";

export const SUGGESTIONS_TOOL_NAME = "daily_suggestions";
export const SUGGESTIONS_TOOL_SCHEMA = {
  type: "object" as const,
  properties: {
    items: {
      type: "array",
      description: "Exactly 5 short, clickable suggestion prompts",
      items: {
        type: "object",
        properties: {
          label: { type: "string", description: "Short chip label (≤ 60 chars), e.g. 'Suggest a fertilization plan'" },
          prompt: { type: "string", description: "The full question sent to the coach when the chip is clicked" },
        },
        required: ["label", "prompt"],
      },
    },
  },
  required: ["items"],
};

/**
 * Returns today's suggestions — from cache when present, otherwise generates
 * (one provider call) and caches. Returns null when AI is off/unreachable —
 * the UI then simply hides the chips (core features unaffected).
 */
export async function getOrCreateDailySuggestions(now: Date = new Date()): Promise<{
  items: { label: string; prompt: string }[];
  cached: boolean;
} | null> {
  const locale = getLocale();
  const cached = getDailySuggestions(now, locale);
  if (cached) return { items: cached.items, cached: true };

  const config = getAiConfig();
  if (!config) return null;

  const startedAt = Date.now();
  let requestBody: Anthropic.Messages.MessageCreateParamsNonStreaming | null = null;
  try {
    const client = new Anthropic({ apiKey: config.apiKey, baseURL: config.baseUrl, timeout: REQUEST_TIMEOUT_MS });
    const context = buildCoachContext(now);

    // context hint: which plan types exist (helps the "if none exists" logic)
    const schedules = listSchedules();
    const planTypes = [...new Set(schedules.map((s) => s.actionType))];

    requestBody = {
      model: config.model,
      max_tokens: 700,
      system: resolveSystemPrompt("suggestions", locale, { context, planTypes }),
      messages: [{ role: "user", content: "Generate today's 5 suggestions." }],
      tools: [
        {
          name: SUGGESTIONS_TOOL_NAME,
          description: "Return the 5 daily suggestions",
          input_schema: { ...SUGGESTIONS_TOOL_SCHEMA, type: "object" },
        },
      ],
      tool_choice: { type: "tool", name: SUGGESTIONS_TOOL_NAME },
    };

    const response = await client.messages.create(requestBody);

    logAiCall({
      purpose: "suggestions",
      provider: providerLabel(config.baseUrl),
      model: config.model,
      request: requestBody,
      response: { content: response.content, usage: response.usage },
      error: null,
      durationMs: Date.now() - startedAt,
    });

    // find the tool_use block
    let raw: unknown = null;
    for (const block of response.content) {
      if (block.type === "tool_use" && block.name === SUGGESTIONS_TOOL_NAME) {
        raw = block.input;
        break;
      }
    }
    const parsed = parseSuggestions(raw ? { day: "1970-01-01", items: raw } : null);
    if (!parsed || parsed.items.length === 0) return null; // malformed → reject, never repair

    const items = parsed.items.slice(0, 6);
    const saved = saveDailySuggestions(items, now, locale);

    // count the call against the daily budget
    const { recordAiCall } = await import("./cost-guard");
    const { estimateCostMicros } = await import("./config");
    recordAiCall({
      provider: providerLabel(config.baseUrl),
      model: config.model,
      purpose: "suggestions",
      promptTokens: response.usage?.input_tokens ?? 0,
      completionTokens: response.usage?.output_tokens ?? 0,
      costEstimateMicros: estimateCostMicros(config.model, response.usage?.input_tokens ?? 0, response.usage?.output_tokens ?? 0),
      now,
    });

    return { items: saved.items, cached: false };
  } catch (err) {
    console.error("[dailySuggestions]", err);
    if (requestBody) {
      logAiCall({
        purpose: "suggestions",
        provider: providerLabel(config.baseUrl),
        model: config.model,
        request: requestBody,
        response: null,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startedAt,
      });
    }
    return null;
  }
}
