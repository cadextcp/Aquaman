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

// MAX_HISTORY_MESSAGES lives in ./constants (client-safe) — re-exported for
// the existing server-side importers.
export { MAX_HISTORY_MESSAGES } from "./constants";
import { MAX_HISTORY_MESSAGES as _mhm } from "./constants";
void _mhm;

import { getAiSettings } from "../settings";
import type { AiProviderSettingsData } from "./provider-presets";
import { readStoredApiKey } from "./key-store";

export function getAiConfig(): AiConfig | null {
  const apiKey = readStoredApiKey() ?? process.env.AQUAMAN_AI_API_KEY?.trim();
  if (!apiKey) return null; // AI off — core features keep working

  // Settings (issue #40: /more → AI provider) take precedence; env is the
  // bootstrap/fallback. The API key can be set from /more too (stored in
  // DATA_DIR, never the DB/exports) and takes precedence over the env var.
  let baseUrl = process.env.AQUAMAN_AI_BASE_URL?.trim() || "https://api.anthropic.com";
  let model = process.env.AQUAMAN_AI_MODEL?.trim() || "";
  let maxCallsPerDay = Math.max(1, Number(process.env.AQUAMAN_AI_MAX_CALLS_PER_DAY) || DEFAULT_MAX_CALLS_PER_DAY);
  let maxTokensPerDay = Math.max(1_000, Number(process.env.AQUAMAN_AI_MAX_TOKENS_PER_DAY) || DEFAULT_MAX_TOKENS_PER_DAY);

  // Settings (issue #40) override env — config.ts is server-only now
  // (client components import from ./constants), so a static import works.
  const stored = loadStoredAiSettings();
  if (stored) {
    baseUrl = stored.baseUrl;
    model = stored.model;
    maxCallsPerDay = stored.maxCallsPerDay;
    maxTokensPerDay = stored.maxTokensPerDay;
  }

  if (!model) return null; // base URL + key without a model is a misconfiguration

  return { baseUrl, apiKey, model, maxCallsPerDay, maxTokensPerDay };
}

/** True when the coach can run at all (key + model present). */
export function isAiConfigured(): boolean {
  return getAiConfig() !== null;
}

/** True when a key exists from either source (stored file or env). */
export function hasApiKey(): boolean {
  return readStoredApiKey() !== null || !!process.env.AQUAMAN_AI_API_KEY?.trim();
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


// ==================== settings bridge (issue #40) ====================

let cachedSettings: AiProviderSettingsData | null | undefined; // undefined = not loaded yet

function loadStoredAiSettings(): AiProviderSettingsData | null {
  if (cachedSettings !== undefined) return cachedSettings;
  try {
    cachedSettings = getAiSettings();
  } catch {
    cachedSettings = null; // DB unavailable (build/prerender) — env stands
  }
  return cachedSettings;
}

/** Called after saving AI settings (API route) so the next read picks them up. */
export function invalidateAiSettingsCache(): void {
  cachedSettings = undefined;
}
