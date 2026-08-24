/**
 * AI configuration (Phase 4 — TechDesign §4.5, §8).
 *
 * One code path, two providers: Anthropic Claude (api.anthropic.com) and
 * z.ai GLM (api.z.ai/api/anthropic) — both speak the Anthropic Messages API.
 * Never hardcode api.anthropic.com (AGENTS.md AI gotcha).
 *
 * All env vars carry the AQUAMAN_ prefix (plan review I2). Without a key the
 * app is fully functional — the coach is the only thing that goes quiet.
 */

export type AiConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  maxCallsPerDay: number;
  maxTokensPerDay: number;
};

/** Two-tier cost ceiling defaults (PRD §5.6; override via env). */
export const DEFAULT_MAX_CALLS_PER_DAY = 20;
export const DEFAULT_MAX_TOKENS_PER_DAY = 200_000;

/** AbortController timeout for the provider call (AGENTS: 30 s fallback). */
export const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Rolling history size for the coach chat (single-call pattern, §9) — the
 * ONE source of truth for this cap. route.ts truncates incoming history to
 * this length, client.ts's normalizeHistory re-caps defensively, and
 * coach-chat.tsx trims before sending. All three must agree: a client that
 * sends more than the route accepts (and doesn't truncate) breaks every
 * request for the rest of the conversation (found in review — a real
 * multi-turn chat died after 7 exchanges before this was unified).
 */
export const MAX_HISTORY_MESSAGES = 12;

export function getAiConfig(): AiConfig | null {
  const apiKey = process.env.AQUAMAN_AI_API_KEY?.trim();
  if (!apiKey) return null; // AI off — core features keep working

  const baseUrl = process.env.AQUAMAN_AI_BASE_URL?.trim() || "https://api.anthropic.com";
  const model = process.env.AQUAMAN_AI_MODEL?.trim() || "";
  if (!model) return null; // base URL + key without a model is a misconfiguration

  const maxCallsPerDay = Math.max(1, Number(process.env.AQUAMAN_AI_MAX_CALLS_PER_DAY) || DEFAULT_MAX_CALLS_PER_DAY);
  const maxTokensPerDay = Math.max(1_000, Number(process.env.AQUAMAN_AI_MAX_TOKENS_PER_DAY) || DEFAULT_MAX_TOKENS_PER_DAY);

  return { baseUrl, apiKey, model, maxCallsPerDay, maxTokensPerDay };
}

/** True when the coach can run at all (key + model present). */
export function isAiConfigured(): boolean {
  return getAiConfig() !== null;
}

/** Provider label for aiCalls telemetry (which configured path was used). */
export function providerLabel(baseUrl: string): string {
  if (baseUrl.includes("z.ai")) return "zai";
  if (baseUrl.includes("anthropic.com")) return "anthropic";
  return "custom";
}

/**
 * Rough cost estimate in micros (1e-6 EUR/USD — the schema column is unitless,
 * it exists to make model switches comparable over time, not for billing).
 * Prices per 1M tokens, Feb 2026 research — re-verify before quoting numbers.
 */
export function estimateCostMicros(model: string, promptTokens: number, completionTokens: number): number {
  const perMTokens: Record<string, [number, number]> = {
    // [input $/M, output $/M]
    "glm-4.6": [0.6, 2.2],
    "claude-sonnet-4-5": [3, 15],
  };
  const [inPerM, outPerM] = perMTokens[model] ?? [1, 5]; // conservative fallback
  return Math.round((promptTokens / 1e6) * inPerM * 1e6 + (completionTokens / 1e6) * outPerM * 1e6);
}
