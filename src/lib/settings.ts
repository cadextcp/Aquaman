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
// locales.ts, not the i18n barrel: settings must not pull the JSON catalogs in
import { DEFAULT_LOCALE, LOCALES, envLocale, type Locale } from "@/i18n/locales";

const KEY = "appSettings.v1";
const AI_KEY = "aiSettings.v1";

export type GlobalSettings = {
  tightGapPolicy: TightGapPolicy;
  tightGapThresholdPct: number;
  /** UI/coach/ICS language — one setting for the whole install (see i18n/locales.ts) */
  locale: Locale;
};

const localeSchema = z.enum(LOCALES as unknown as [Locale, ...Locale[]]);

export const globalSettingsSchema = z.object({
  tightGapPolicy: z.enum(["fixed", "suppress"]),
  tightGapThresholdPct: z.number().int().min(1).max(99),
  locale: localeSchema,
});

/**
 * Read schema: `locale` is OPTIONAL here because rows written before the
 * language setting existed have no such field — requiring it would make the
 * whole row invalid and silently reset the owner's tight-gap defaults too.
 */
const storedSettingsSchema = globalSettingsSchema.partial({ locale: true });

/** Patch schema: every field optional, so a caller may save just the language. */
const settingsPatchSchema = storedSettingsSchema.partial();

export const DEFAULT_GLOBAL_SETTINGS: GlobalSettings = {
  tightGapPolicy: "suppress",
  tightGapThresholdPct: 50,
  locale: DEFAULT_LOCALE,
};

export function getGlobalSettings(): GlobalSettings {
  let row: { value: unknown } | undefined;
  try {
    row = db.select().from(appSettings).where(eq(appSettings.key, KEY)).get();
  } catch {
    // The root layout reads the locale on EVERY render, including the static
    // prerender of /_not-found at build time — where no migrated DB exists
    // yet. Falling back keeps the build (and a pre-migration boot) working.
    return { ...DEFAULT_GLOBAL_SETTINGS, locale: envLocale() };
  }
  const parsed = storedSettingsSchema.safeParse(row?.value);
  if (!parsed.success) return { ...DEFAULT_GLOBAL_SETTINGS, locale: envLocale() };
  // legacy row (or a fresh install): AQUAMAN_LOCALE bootstraps the language
  return { ...parsed.data, locale: parsed.data.locale ?? envLocale() };
}

/**
 * MERGES into the stored settings instead of replacing them: the /more page
 * saves each block on its own (tight gap, language), and a full replace would
 * let one form silently reset another's field.
 */
export function saveGlobalSettings(input: unknown): GlobalSettings {
  const patch = settingsPatchSchema.parse(input); // throws on invalid — caller catches
  const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  const next = globalSettingsSchema.parse({ ...getGlobalSettings(), ...defined });
  db.insert(appSettings)
    .values({ key: KEY, value: next })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: next } })
    .run();
  return next;
}

/** The active language — the one place server rendering, the ICS feed and the coach agree on. */
export function getLocale(): Locale {
  return getGlobalSettings().locale;
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


// ==================== daily coach suggestions cache (issue #41) ====================

import { parseSuggestions, type DailySuggestions } from "./ai/proposal";
import { today as todayStrLocal } from "./domain/dates";

const SUGG_KEY = "coachSuggestions.v1";

export function getDailySuggestions(now: Date = new Date()): DailySuggestions | null {
  const row = db.select().from(appSettings).where(eq(appSettings.key, SUGG_KEY)).get();
  const parsed = parseSuggestions(row?.value);
  if (!parsed) return null;
  return parsed.day === todayStrLocal(undefined, now) ? parsed : null; // stale day → miss
}

export function saveDailySuggestions(items: { label: string; prompt: string }[], now: Date = new Date()): DailySuggestions {
  const payload: DailySuggestions = { day: todayStrLocal(undefined, now), items };
  const parsed = parseSuggestions(payload);
  if (!parsed) throw new Error("invalid suggestions");
  db.insert(appSettings)
    .values({ key: SUGG_KEY, value: parsed })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: parsed } })
    .run();
  return parsed;
}
