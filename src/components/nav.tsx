import Link from "next/link";

/** Shared nav config — single source (issue #16 cleanup). Phosphor icons since #43. */
const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: "house" },
  { href: "/tanks", label: "Tanks", icon: "fish" },
  { href: "/calendar", label: "Calendar", icon: "calendar-blank" },
  { href: "/coach", label: "Coach", icon: "sparkle" },
  { href: "/more", label: "More", icon: "sliders-horizontal" },
] as const;

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
      <div className="grid grid-cols-5">
        {NAV_ITEMS.map((i) => (
          <Link
            key={i.href}
            href={i.href}
            className="flex flex-col items-center justify-center gap-1 py-2 text-xs"
            style={{ color: "var(--muted-foreground)", minHeight: 56 }}
          >
            <i aria-hidden className={`ph ph-${i.icon} text-xl`} />
            {i.label}
          </Link>
        ))}
      </div>
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
      <div className="text-lg font-bold mb-4 px-2 flex items-center gap-2" style={{ color: "var(--accent-light)" }}>
        <i aria-hidden className="ph ph-drop text-2xl" />
        Aquaman
      </div>
      {NAV_ITEMS.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm hover:bg-white/5"
          style={{ color: "var(--secondary-foreground)" }}
        >
          <i aria-hidden className={`ph ph-${i.icon} text-lg`} />
          {i.label}
        </Link>
      ))}
    </aside>
  );
}
