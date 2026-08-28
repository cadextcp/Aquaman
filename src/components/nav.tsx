import { CoachNavItem } from "./coach-badge";
import { NavItem, type NavVariant } from "./ui/nav-item";

/** Shared nav config — single source (issue #16 cleanup). Phosphor icons since #43. */
const NAV_ITEMS = [
  { href: "/", label: "Today", icon: "house" },
  { href: "/tanks", label: "Tanks", icon: "fish" },
  { href: "/calendar", label: "Plan", icon: "calendar-blank" },
  { href: "/coach", label: "Coach", icon: "sparkle" },
  { href: "/more", label: "More", icon: "sliders-horizontal" },
] as const;

/**
 * Renders the config in order. Coach is the one item with a badge, so it gets
 * its own client component — but it sits in its natural position instead of
 * being spliced in around two `slice()` calls.
 */
function items(variant: NavVariant) {
  return NAV_ITEMS.map((i) =>
    i.href === "/coach" ? (
      <CoachNavItem key={i.href} variant={variant} />
    ) : (
      <NavItem key={i.href} {...i} variant={variant} />
    ),
  );
}

/** Bottom navigation (mobile-first). Desktop gets a sidebar. */
export function BottomNav() {
  return (
    <nav
      aria-label="Main navigation"
      className="fixed bottom-0 inset-x-0 z-50 lg:hidden"
      style={{
        background: "var(--card)",
        borderTop: "1px solid var(--border)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      <div className="grid grid-cols-5">{items("bottom")}</div>
    </nav>
  );
}

/** Desktop sidebar (lg+). */
export function SideNav() {
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
        Aquaman
      </div>
      {items("side")}
    </aside>
  );
}
