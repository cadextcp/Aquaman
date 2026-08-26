/**
 * The AI part of the plan review — isolated so tests can import plan-review.ts
 * without touching the SDK (and vice versa). Single call, tool-use enforced,
 * zod-validated, counted against the daily budget (purpose 'plan_review').
 */

import Anthropic from "@anthropic-ai/sdk";
import { getAiConfig, providerLabel, estimateCostMicros, REQUEST_TIMEOUT_MS } from "./config";
import { recordAiCall } from "./cost-guard";
import { buildCoachContext } from "./context";
import { listSchedules } from "@/lib/repo";
import { planReviewResultSchema } from "./plan-review";

const TOOL_NAME = "plan_review_result";

const SYSTEM = `You review an aquarium care plan after a relevant change. Decide whether the care plan should change.
Trigger will be "tank_change" (master data like fish, plants, volume or equipment changed) or "water_test" (new water values were measured).
Look at the current plans (intervals, details, weekday masks), the tank context and the latest water values (including calculated free NH3).
Typical cases: more fish → more feeding/waste → maybe shorter water-change interval or higher change volume; plant growth → adjusted fertilization; rising nitrate → shorter water-change cadence; cycling tank finished → relax testing cadence.
Rules:
- If the current plan is still appropriate, return shouldChange=false with a one-line summary. Do NOT invent changes.
- If changes make sense, return shouldChange=true, a one-sentence summary of WHY, and up to 3 prompts the user can click — each prompt must be a complete, self-contained question for the coach (it will be sent verbatim into the chat), e.g. "Please update my water change plan for Nano Cube 60: nitrate is rising, suggest a new interval".
- Labels are short chip texts (max ~60 chars), action-oriented.
- Fertilizer/water-change amounts only, never medication dosages; always remind to verify fertilizer dosages against the product label in the prompt text.
- If a tank's context lists "fish: NONE", it has NO fish. NEVER propose feeding-related plan changes or feeding prompts for it — only plants-relevant care (fertilization, water changes, testing).`

export async function executePlanReview(
  reason: "tank_change" | "water_test",
): Promise<{ shouldChange: boolean; summary: string; prompts: { label: string; prompt: string }[] } | null> {
  const config = getAiConfig();
  if (!config) return null;

  const client = new Anthropic({ apiKey: config.apiKey, baseURL: config.baseUrl, timeout: REQUEST_TIMEOUT_MS });
  const context = buildCoachContext();
  const planTypes = [...new Set(listSchedules().map((s) => s.actionType))];
  const system = `${SYSTEM}\n\n=== USER DATA CONTEXT ===\n${context}\n\nEXISTING PLAN TYPES: ${planTypes.join(", ") || "(none)"}`;

  const response = await client.messages.create({
    model: config.model,
    max_tokens: 600,
    system,
    messages: [{ role: "user", content: `Trigger: ${reason}. Review the care plan now.` }],
    tools: [
      {
        name: TOOL_NAME,
        description: "Return the plan review verdict",
        input_schema: {
          type: "object",
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
        },
      },
    ],
    tool_choice: { type: "tool", name: TOOL_NAME },
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
    if (block.type === "tool_use" && block.name === TOOL_NAME) {
      raw = block.input;
      break;
    }
  }
  if (raw === null) return null; // malformed → reject, never repair

  const parsed = planReviewResultSchema.safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data;
}
