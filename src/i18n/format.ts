/**
 * Locale-aware date/number formatting.
 *
 * Before this, four places hardcoded `toLocaleDateString("en-US")` and one
 * built "Monday 24 August" by hand — both produce English regardless of the
 * chosen language, and the hand-built one has no German word order at all
 * ("Montag, 24. August").
 *
 * All date inputs are date-only strings (YYYY-MM-DD) — the app's own format —
 * and are read in UTC, exactly like the callers did before: these strings are
 * already the LOCAL day (AQUAMAN_TIMEZONE, see domain/dates.ts). Re-reading
 * them in the runtime's zone would shift them by a day for evening users.
 */

import { LOCALE_TAG, type Locale } from "./locales";

/** Date-only string → UTC Date, so formatting never shifts the day. */
function utcDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
}

const UTC = { timeZone: "UTC" } as const;

/** Dashboard header: "Monday 24 August" · "Montag, 24. August" */
export function formatDateLong(dateStr: string, locale: Locale): string {
  return utcDate(dateStr).toLocaleDateString(LOCALE_TAG[locale], {
    weekday: "long",
    day: "numeric",
    month: "long",
    ...UTC,
  });
}

/** Feeding day pill: "Mon, Aug 25" · "Mo., 25. Aug." */
export function formatDateShort(dateStr: string, locale: Locale): string {
  return utcDate(dateStr).toLocaleDateString(LOCALE_TAG[locale], {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...UTC,
  });
}

/** Calendar heading from a YYYY-MM string: "September 2026" · "September 2026" */
export function formatMonth(monthStr: string, locale: Locale): string {
  return utcDate(`${monthStr}-01`).toLocaleDateString(LOCALE_TAG[locale], {
    month: "long",
    year: "numeric",
    ...UTC,
  });
}

/** Full timestamp for the debug view (an ISO instant, shown in the app's timezone). */
export function formatDateTime(iso: string, locale: Locale, timeZone?: string): string {
  return new Date(iso).toLocaleString(LOCALE_TAG[locale], {
    dateStyle: "medium",
    timeStyle: "medium",
    ...(timeZone ? { timeZone } : {}),
  });
}

/** Token/call counters: "200,000" · "200.000" */
export function formatNumber(n: number, locale: Locale): string {
  return n.toLocaleString(LOCALE_TAG[locale]);
}

/** Weekday names for the calendar grid header, Monday-first (bit 0 = Mon, see domain/dates.ts). */
export function weekdayLabels(locale: Locale, width: "short" | "long" = "short"): string[] {
  // 2026-08-31 is a Monday — anchor the week there and walk seven days.
  return Array.from({ length: 7 }, (_, i) =>
    new Date(Date.UTC(2026, 7, 31 + i)).toLocaleDateString(LOCALE_TAG[locale], { weekday: width, ...UTC }),
  );
}
