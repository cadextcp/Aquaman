"use client";

/**
 * Language switcher (/more). One setting for the whole install: the UI, the
 * ICS event titles and the coach's answers all follow it — see
 * lib/settings.ts:getLocale().
 *
 * Saving triggers router.refresh() so the server re-renders every string in
 * the new language immediately; the labels here stay in their OWN language
 * ("English"/"Deutsch"), which is what makes the switch usable when you can't
 * read the current one.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveGlobalSettingsAction } from "@/app/actions";
import { LOCALES, LOCALE_LABELS, type Locale } from "@/i18n/locales";
import { useI18n } from "@/i18n/provider";
import { StatusNote } from "./ui/status-note";

export function LanguageSettings({ initialLocale }: { initialLocale: Locale }) {
  const router = useRouter();
  const { t, errorText } = useI18n();
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function choose(next: Locale) {
    if (next === locale || pending) return;
    const previous = locale;
    setLocale(next); // optimistic — the refresh below repaints the whole app
    setError(null);
    const res = await saveGlobalSettingsAction({ locale: next });
    if (!res.ok) {
      setLocale(previous);
      setError(errorText(res));
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <div className="rounded-xl p-5 edge-card">
      <div className="text-xs uppercase tracking-wide mb-2" style={{ color: "var(--muted-foreground)" }}>
        {t("settings.language.title")}
      </div>
      <p className="text-sm mb-3" style={{ color: "var(--muted-foreground)" }}>
        {t("settings.language.description")}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {LOCALES.map((loc) => {
          const active = loc === locale;
          return (
            <button
              key={loc}
              type="button"
              onClick={() => choose(loc)}
              disabled={pending}
              aria-pressed={active}
              className="rounded-lg px-3 py-2 text-sm font-medium"
              style={{
                minHeight: 44,
                background: active ? "var(--accent-soft)" : "var(--secondary)",
                boxShadow: active ? "inset 0 0 0 1px var(--accent)" : "none",
                color: active ? "var(--accent-light)" : "var(--secondary-foreground)",
                opacity: pending ? 0.6 : 1,
              }}
            >
              {LOCALE_LABELS[loc]}
            </button>
          );
        })}
      </div>
      {error && (
        <div className="mt-3">
          <StatusNote tone="error">{error}</StatusNote>
        </div>
      )}
    </div>
  );
}
