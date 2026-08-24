/**
 * Global app settings (appSettings-backed, issue #39/#40):
 * - tight-gap default: the "after catching up" behavior, described properly
 *   in /more instead of hiding it per-schedule
 * - AI provider/model/limits (API key stays env-only — never in the DB)
 *
 * Settings take precedence over env; env stays as bootstrap/fallback.
 */

import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { appSettings } from "@/lib/db/schema";
import type { TightGapPolicy } from "@/lib/domain/scheduler";

const KEY = "appSettings.v1";
const AI_KEY = "aiSettings.v1";

export type GlobalSettings = {
  tightGapPolicy: TightGapPolicy;
  tightGapThresholdPct: number;
};

export const globalSettingsSchema = z.object({
  tightGapPolicy: z.enum(["fixed", "suppress"]),
  tightGapThresholdPct: z.number().int().min(1).max(99),
});

export const DEFAULT_GLOBAL_SETTINGS: GlobalSettings = {
  tightGapPolicy: "suppress",
  tightGapThresholdPct: 50,
};

export function getGlobalSettings(): GlobalSettings {
  const row = db.select().from(appSettings).where(eq(appSettings.key, KEY)).get();
  const parsed = globalSettingsSchema.safeParse(row?.value);
  return parsed.success ? parsed.data : DEFAULT_GLOBAL_SETTINGS;
}

export function saveGlobalSettings(input: unknown): GlobalSettings {
  const parsed = globalSettingsSchema.parse(input); // throws on invalid — caller catches
  db.insert(appSettings)
    .values({ key: KEY, value: parsed })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: parsed } })
    .run();
  return parsed;
}


// ==================== AI provider settings (issue #40) ====================

export { PROVIDER_PRESETS } from "./ai/provider-presets";
export type { AiProviderSettingsData } from "./ai/provider-presets";
import type { AiProviderSettingsData } from "./ai/provider-presets";
import { aiSettingsSchema } from "./ai/provider-presets";

export function getAiSettings(): AiProviderSettingsData | null {
  const row = db.select().from(appSettings).where(eq(appSettings.key, AI_KEY)).get();
  const parsed = aiSettingsSchema.safeParse(row?.value);
  return parsed.success ? parsed.data : null;
}

export function saveAiSettings(input: unknown): AiProviderSettingsData {
  const parsed = aiSettingsSchema.parse(input);
  db.insert(appSettings)
    .values({ key: AI_KEY, value: parsed })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: parsed } })
    .run();
  return parsed;
}
