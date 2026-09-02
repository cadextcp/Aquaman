/**
 * Server-side i18n entry point: the bundled catalogs plus the typed helpers
 * built on core.ts.
 *
 * Client components do NOT import this (it pulls every locale's JSON) — they
 * read the active catalog from LocaleProvider via useI18n(); see provider.tsx.
 * The active locale itself lives in the global settings (see lib/settings.ts),
 * so server rendering, the ICS feed and the coach all agree on one language.
 */
import en from "./en.json";
import de from "./de.json";
import {
  translate,
  plural as pluralFrom,
  actionLabelFrom,
  domainLabelFrom,
  lookup,
  helpTopicFrom,
  helpNoteFrom,
  type Catalog,
  type HelpTopic,
  type Vars,
} from "./core";
import { DEFAULT_LOCALE, type Locale } from "./locales";

export { LOCALES, DEFAULT_LOCALE, LOCALE_LABELS, LOCALE_TAG, isLocale, envLocale } from "./locales";
export type { Locale } from "./locales";
export { formatDateLong, formatDateShort, formatMonth, formatDateTime, formatNumber, weekdayLabels } from "./format";
export type { Catalog, Vars } from "./core";

const catalogs: Record<Locale, Catalog> = { en: en as Catalog, de: de as Catalog };

/** The whole catalog for one locale — handed to the client provider by the root layout. */
export function catalogFor(locale: Locale): Catalog {
  return catalogs[locale] ?? catalogs[DEFAULT_LOCALE];
}

/** Tiny t() — dot-key lookup with {placeholder} interpolation. Missing key → the key itself. */
export function t(key: string, locale: Locale = DEFAULT_LOCALE, vars?: Vars): string {
  return translate(catalogFor(locale), key, vars);
}

/** Counted copy ("1 task" / "2 Aufgaben") — see core.ts:plural for the catalog shape. */
export function plural(key: string, n: number, locale: Locale = DEFAULT_LOCALE, vars?: Vars): string {
  return pluralFrom(catalogFor(locale), key, n, vars);
}

/**
 * Localized action-type name ("water_change" → "Wasserwechsel"). Used wherever
 * a type is shown to a person — calendar, cards, ICS SUMMARY. The REST API and
 * the DB keep the raw snake_case key (machine contract).
 */
export function actionLabelFor(actionType: string, locale: Locale = DEFAULT_LOCALE): string {
  return actionLabelFrom(catalogFor(locale), actionType);
}

/**
 * Localized water-parameter name ("no2" → "Nitrit (NO₂)"). The `fallback` is
 * the domain label from ranges.ts, so a parameter added there but not yet in
 * the catalogs still reads as a name rather than a key.
 */
export function paramLabelFor(key: string, locale: Locale = DEFAULT_LOCALE, fallback?: string): string {
  return domainLabelFrom(catalogFor(locale), "param", key, fallback);
}

/** Localized fertilizer-nutrient name ("fe" → "Eisen (Fe)"). */
export function nutrientLabelFor(key: string, locale: Locale = DEFAULT_LOCALE, fallback?: string): string {
  return domainLabelFrom(catalogFor(locale), "nutrient", key, fallback);
}

/** Raw catalog lookup — for entries that are not plain strings (lists, objects). */
function raw(key: string, locale: Locale): unknown {
  return lookup(catalogFor(locale), key);
}

export type { HelpTopic } from "./core";

/**
 * In-app explanations (help.*). Copy lives in the catalogs so the largest body
 * of text in the app is translatable from day one — a hardcoded string would
 * break the German locale silently (AGENTS.md).
 */
export function helpTopic(id: string, locale: Locale = DEFAULT_LOCALE): HelpTopic | null {
  return helpTopicFrom(catalogFor(locale), id);
}

/** One-line E2 micro-copy (help.notes.*). */
export function helpNote(id: string, locale: Locale = DEFAULT_LOCALE): string {
  return helpNoteFrom(catalogFor(locale), id);
}

export type ConceptSection = { id: string; heading: string; body: string[] };

/** The concepts page (help.concepts.*). */
export function concepts(locale: Locale = DEFAULT_LOCALE): {
  title: string;
  lede: string;
  sections: ConceptSection[];
} {
  const v = raw("help.concepts", locale) as
    | { title?: string; lede?: string; sections?: ConceptSection[] }
    | undefined;
  return {
    title: v?.title ?? "",
    lede: v?.lede ?? "",
    sections: Array.isArray(v?.sections) ? v.sections : [],
  };
}
