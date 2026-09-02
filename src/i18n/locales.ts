/**
 * The locale list — deliberately catalog-free.
 *
 * settings.ts, the client provider and the domain formatters all need to know
 * WHICH locales exist without pulling in en.json/de.json (~26 KB). Keeping the
 * list in its own module is what lets the client bundle ship a single catalog
 * instead of every translation the app owns.
 */

export type Locale = "en" | "de";

export const LOCALES: readonly Locale[] = ["en", "de"] as const;
export const DEFAULT_LOCALE: Locale = "en";

/** Shown in the language switcher — always in the language itself, never translated. */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  de: "Deutsch",
};

/**
 * BCP-47 tag for `Intl.*` and `<html lang>`. Region-qualified on purpose:
 * bare "de" formats dates as "24.8.2026" in some runtimes, "de-DE" is stable.
 */
export const LOCALE_TAG: Record<Locale, string> = {
  en: "en-US",
  de: "de-DE",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * Bootstrap locale for a fresh install (`AQUAMAN_LOCALE=de` in compose).
 * Once the owner picks a language in /more, the stored setting wins.
 */
export function envLocale(): Locale {
  const raw = process.env.AQUAMAN_LOCALE?.trim().toLowerCase();
  return isLocale(raw) ? raw : DEFAULT_LOCALE;
}
