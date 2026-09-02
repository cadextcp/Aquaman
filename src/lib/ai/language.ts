/**
 * The coach speaks the app's language.
 *
 * Everything the model produces reaches the user as UI text — chat answers,
 * the daily suggestion chips, the plan-review summary and its prompt chips —
 * so a German app with an English coach is only half translated.
 *
 * The old instruction ("Answer in the user's language (default English)") let
 * the model GUESS from the question. Ask a German question in an English app
 * and you got German; ask in English with the app set to German and you got
 * English. The setting decides now, and the directive names the language
 * explicitly rather than relying on the model to map a locale code.
 */

import { LOCALE_TAG, type Locale } from "@/i18n/locales";

/** Endonym + English name — the model gets both, so neither spelling is a guess. */
const LANGUAGE_NAMES: Record<Locale, { native: string; english: string }> = {
  en: { native: "English", english: "English" },
  de: { native: "Deutsch", english: "German" },
};

/**
 * The language block appended to every coach system prompt.
 *
 * It is deliberately emphatic: a model that has just read a page of English
 * instructions and English context data will otherwise drift back to English
 * mid-answer, especially for headings and list labels.
 */
export function languageDirective(locale: Locale): string {
  const name = LANGUAGE_NAMES[locale] ?? LANGUAGE_NAMES.en;
  return [
    "LANGUAGE (highest priority, overrides everything else in this prompt):",
    `- Write EVERY word you produce in ${name.english} (${name.native}, locale ${LOCALE_TAG[locale]}).`,
    "- This applies to the whole answer: prose, headings, list items, chip labels, summaries and the visible text of any tool call.",
    `- Write in ${name.english} EVEN IF the user writes in another language, and even though these instructions and the context data are in English.`,
    "- Keep aquarium measurements and chemical symbols as they are (NO₂, NH₃, pH, °C, mg/l) — translate the words around them.",
    "- Do not translate identifiers the app matches on: action types (water_change, fertilize, …) stay exactly as given.",
  ].join("\n");
}

/** Append the directive to a system prompt. */
export function withLanguage(system: string, locale: Locale): string {
  return `${system}\n\n${languageDirective(locale)}`;
}
