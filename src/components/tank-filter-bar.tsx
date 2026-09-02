import Link from "next/link";
import { t, DEFAULT_LOCALE, type Locale } from "@/i18n";

/**
 * Shared tank filter chip row — "All tanks" + one chip per tank. Used by the
 * dashboard and the calendar; both pages own their own `hrefFor` so the
 * OTHER query params on that page (day/month) are preserved across a tank
 * switch, and vice versa (see each page's `hrefFor`).
 *
 * `allowAll={false}` (the Coach page) drops the "All tanks" chip entirely —
 * there, exactly one tank must always be selected (`selectedTankId` is never
 * null in that mode; the page picks a default before rendering this).
 */
export function TankFilterBar({
  tanks,
  selectedTankId,
  hrefFor,
  allowAll = true,
  locale = DEFAULT_LOCALE,
}: {
  tanks: { id: number; name: string }[];
  selectedTankId: number | null;
  hrefFor: (tankId: number | null) => string;
  allowAll?: boolean;
  /** Server component — the page resolves the locale once and passes it down. */
  locale?: Locale;
}) {
  if (tanks.length <= 1) return null;

  const chip = (id: number | null, label: string) => {
    const active = selectedTankId === id;
    return (
      <Link
        key={id ?? "all"}
        href={hrefFor(id)}
        className="rounded-lg px-3 py-1.5 text-xs font-medium"
        style={{
          minHeight: 32,
          background: active ? "var(--accent-soft)" : "var(--secondary)",
          boxShadow: active ? "inset 0 0 0 1px var(--accent)" : "none",
          color: active ? "var(--accent-light)" : "var(--secondary-foreground)",
        }}
      >
        {label}
      </Link>
    );
  };

  return (
    <div className="flex flex-wrap gap-1.5 mb-6">
      {allowAll && chip(null, t("tankFilter.allTanks", locale))}
      {tanks.map((tk) => chip(tk.id, tk.name))}
    </div>
  );
}
