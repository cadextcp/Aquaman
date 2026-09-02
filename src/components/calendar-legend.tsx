/**
 * What the three stripe colours in the month grid mean. The grid has carried
 * them since the calendar shipped without ever naming them.
 */
import { helpNote, DEFAULT_LOCALE, type Locale } from "@/i18n";

const KEYS = [
  { color: "var(--warning)", label: "behind" },
  { color: "var(--due)", label: "due today" },
  { color: "var(--accent)", label: "planned" },
] as const;

/** Server component — the page resolves the locale once and passes it down. */
export function CalendarLegend({ locale = DEFAULT_LOCALE }: { locale?: Locale }) {
  // the note carries the same three words, so the catalog stays the source
  const labels = helpNote("calendarLegend", locale).split("·").map((s) => s.trim());
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mb-3">
      {KEYS.map((k, i) => (
        <span key={k.label} className="flex items-center gap-1.5 text-xs" style={{ color: "var(--muted-foreground)" }}>
          <span aria-hidden className="rounded-full" style={{ width: 14, height: 3, background: k.color }} />
          {labels[i] || k.label}
        </span>
      ))}
    </div>
  );
}
