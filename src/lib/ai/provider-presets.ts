/**
 * Client-safe AI provider presets + types (issue #40).
 * No DB imports here — settings.ts (server) re-uses these.
 */

export type AiProviderId = "zai" | "anthropic" | "kimi" | "custom";

export type AiProviderSettingsData = {
  provider: AiProviderId;
  baseUrl: string;
  model: string;
  maxCallsPerDay: number;
  maxTokensPerDay: number;
};

/** Common Anthropic-compatible endpoints (verify current docs before use). */
export const PROVIDER_PRESETS: Record<Exclude<AiProviderId, "custom">, { label: string; baseUrl: string; models: string[] }> = {
  zai: { label: "z.ai (GLM)", baseUrl: "https://api.z.ai/api/anthropic", models: ["glm-5.3", "glm-4.6"] },
  anthropic: { label: "Anthropic (Claude)", baseUrl: "https://api.anthropic.com", models: ["claude-sonnet-4-5", "claude-haiku-4-5"] },
  kimi: { label: "Moonshot Kimi", baseUrl: "https://api.moonshot.ai/api/anthropic", models: ["kimi-k2"] },
};

import { z } from "zod";

export const aiSettingsSchema = z.object({
  provider: z.enum(["zai", "anthropic", "kimi", "custom"]),
  baseUrl: z.string().trim().url().max(200),
  model: z.string().trim().min(1).max(80),
  maxCallsPerDay: z.number().int().min(1).max(1000),
  maxTokensPerDay: z.number().int().min(1000).max(10_000_000),
});
