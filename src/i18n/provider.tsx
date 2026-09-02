"use client";

/**
 * Locale context for client components.
 *
 * The root layout resolves the active locale from the global settings and
 * hands this provider THAT ONE catalog — client components never import
 * i18n/index.ts, so only the language actually in use crosses the wire
 * (before this, help.tsx pulled both catalogs into the client bundle).
 *
 * Server components don't need any of this: they call t()/plural() from
 * i18n/index.ts with the locale the page already resolved.
 */

import { createContext, useContext, useMemo } from "react";
import {
  translate,
  plural as pluralFrom,
  actionLabelFrom,
  domainLabelFrom,
  helpNoteFrom,
  helpTopicFrom,
  type Catalog,
  type HelpTopic,
  type Vars,
} from "./core";
import { DEFAULT_LOCALE, type Locale } from "./locales";
import { formatDateLong, formatDateShort, formatMonth, formatNumber, weekdayLabels } from "./format";

export type I18n = {
  locale: Locale;
  /** Resolve a key ("dashboard.dueToday"), interpolating {placeholders}. */
  t: (key: string, vars?: Vars) => string;
  /** Counted copy — "1 task" / "2 Aufgaben" (see core.ts:plural). */
  plural: (key: string, n: number, vars?: Vars) => string;
  /** Localized name of an action type ("water_change" → "Wasserwechsel"). */
  actionLabel: (actionType: string) => string;
  /** Localized water-parameter name; `fallback` is the domain label from ranges.ts. */
  paramLabel: (key: string, fallback?: string) => string;
  /** Localized fertilizer-nutrient name. */
  nutrientLabel: (key: string, fallback?: string) => string;
  helpTopic: (id: string) => HelpTopic | null;
  helpNote: (id: string) => string;
  formatDateLong: (dateStr: string) => string;
  formatDateShort: (dateStr: string) => string;
  formatMonth: (monthStr: string) => string;
  formatNumber: (n: number) => string;
  /** Monday-first weekday names (bit 0 = Mon, like the schedule mask). */
  weekdayLabels: (width?: "short" | "long") => string[];
};

/**
 * Default context: English keys resolve to themselves rather than throwing.
 * A component rendered outside the provider (a test, a stray portal) shows the
 * key instead of crashing — and the i18n test catches it before release.
 */
const LocaleContext = createContext<{ locale: Locale; catalog: Catalog }>({
  locale: DEFAULT_LOCALE,
  catalog: {},
});

export function LocaleProvider({
  locale,
  catalog,
  children,
}: {
  locale: Locale;
  catalog: Catalog;
  children: React.ReactNode;
}) {
  const value = useMemo(() => ({ locale, catalog }), [locale, catalog]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useI18n(): I18n {
  const { locale, catalog } = useContext(LocaleContext);
  return useMemo(
    () => ({
      locale,
      t: (key, vars) => translate(catalog, key, vars),
      plural: (key, n, vars) => pluralFrom(catalog, key, n, vars),
      actionLabel: (actionType) => actionLabelFrom(catalog, actionType),
      paramLabel: (key, fallback) => domainLabelFrom(catalog, "param", key, fallback),
      nutrientLabel: (key, fallback) => domainLabelFrom(catalog, "nutrient", key, fallback),
      helpTopic: (id) => helpTopicFrom(catalog, id),
      helpNote: (id) => helpNoteFrom(catalog, id),
      formatDateLong: (dateStr) => formatDateLong(dateStr, locale),
      formatDateShort: (dateStr) => formatDateShort(dateStr, locale),
      formatMonth: (monthStr) => formatMonth(monthStr, locale),
      formatNumber: (n) => formatNumber(n, locale),
      weekdayLabels: (width) => weekdayLabels(locale, width),
    }),
    [locale, catalog],
  );
}
