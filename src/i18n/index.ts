/**
 * Minimal i18n (PRD: en first, de from Phase 2 — structure exists from day 1).
 * Server-side: reads NEXT_PUBLIC default locale; locale switching via cookie
 * comes with the settings UI. Keep keys typed loosely for now.
 */
import en from "./en.json";
import de from "./de.json";

export type Locale = "en" | "de";
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALES: Locale[] = ["en", "de"];

const catalogs: Record<Locale, unknown> = { en, de };

/** Tiny t() — flat dot-key lookup with {placeholder} interpolation. */
export function t(key: string, locale: Locale = DEFAULT_LOCALE, vars?: Record<string, string | number>): string {
  const cat = catalogs[locale] ?? en;
  const parts = key.split(".");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cur: any = cat;
  for (const p of parts) {
    cur = cur?.[p];
    if (cur === undefined) break;
  }
  let str = typeof cur === "string" ? cur : key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replaceAll(`{${k}}`, String(v));
    }
  }
  return str;
}
