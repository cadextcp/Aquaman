import { CoachNavItem } from "./coach-badge";
import { NavItem, type NavVariant } from "./ui/nav-item";
import { getLocale } from "@/lib/settings";
import { t, type Locale } from "@/i18n";

/**
 * Shared nav config — single source (issue #16 cleanup). Phosphor icons since #43.
 * `labelKey` rather than a label: both navs are server components, so the
 * label is resolved once per render from the install's language.
 */
const NAV_ITEMS = [
  { href: "/", labelKey: "nav.today", icon: "house" },
  { href: "/tanks", labelKey: "nav.tanks", icon: "fish" },
  { href: "/calendar", labelKey: "nav.plan", icon: "calendar-blank" },
  { href: "/coach", labelKey: "nav.coach", icon: "sparkle" },
  { href: "/more", labelKey: "nav.more", icon: "sliders-horizontal" },
] as const;

/**
 * Renders the config in order. Coach is the one item with a badge, so it gets
 * its own client component — but it sits in its natural position instead of
 * being spliced in around two `slice()` calls.
 */
function items(variant: NavVariant, locale: Locale) {
  return NAV_ITEMS.map((i) =>
    i.href === "/coach" ? (
      <CoachNavItem key={i.href} variant={variant} />
    ) : (
      <NavItem key={i.href} href={i.href} icon={i.icon} label={t(i.labelKey, locale)} variant={variant} />
    ),
  );
}

/** Bottom navigation (mobile-first). Desktop gets a sidebar. */
export function BottomNav() {
  const locale = getLocale();
  return (
    <nav
      aria-label={t("nav.aria", locale)}
      className="fixed bottom-0 inset-x-0 z-50 lg:hidden"
      style={{
        background: "var(--card)",
        borderTop: "1px solid var(--border)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      <div className="grid grid-cols-5">{items("bottom", locale)}</div>
    </nav>
  );
}

/** Desktop sidebar (lg+). */
export function SideNav() {
  const locale = getLocale();
  return (
    <aside
      className="hidden lg:flex lg:flex-col lg:w-60 lg:border-r p-4 gap-1"
      style={{ borderColor: "var(--border)", background: "var(--card)" }}
    >
      <div
        className="text-lg font-bold mb-4 px-2 flex items-center gap-2"
        style={{ color: "var(--accent-light)" }}
      >
        <i aria-hidden className="ph ph-drop text-2xl" />
        {t("app.name", locale)}
      </div>
      {items("side", locale)}
    </aside>
  );
}
