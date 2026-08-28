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

/** Raw catalog lookup — for entries that are not plain strings (lists, objects). */
function raw(key: string, locale: Locale): unknown {
  const cat = catalogs[locale] ?? en;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cur: any = cat;
  for (const p of key.split(".")) {
    cur = cur?.[p];
    if (cur === undefined) return undefined;
  }
  return cur;
}

/** A help topic: the title of an E3 sheet plus its paragraphs. */
export type HelpTopic = {
  title: string;
  body: string[];
  /** anchor on the concepts page, when the topic has a longer explanation there */
  more?: string;
};

/**
 * In-app explanations (help.*). Copy lives in the catalogs so the largest body
 * of text in the app is translatable from day one — a hardcoded string would
 * break the German locale silently (AGENTS.md).
 */
export function helpTopic(id: string, locale: Locale = DEFAULT_LOCALE): HelpTopic | null {
  const v = raw(`help.topics.${id}`, locale);
  if (!v || typeof v !== "object") return null;
  const o = v as { title?: unknown; body?: unknown; more?: unknown };
  if (typeof o.title !== "string" || !Array.isArray(o.body)) return null;
  return {
    title: o.title,
    body: o.body.filter((x): x is string => typeof x === "string"),
    more: typeof o.more === "string" ? o.more : undefined,
  };
}

/** One-line E2 micro-copy (help.notes.*). */
export function helpNote(id: string, locale: Locale = DEFAULT_LOCALE): string {
  const v = raw(`help.notes.${id}`, locale);
  return typeof v === "string" ? v : "";
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
