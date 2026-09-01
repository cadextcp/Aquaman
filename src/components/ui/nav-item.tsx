"use client";

/**
 * One nav link, shared by the bottom bar, the sidebar and the badged Coach
 * item. Lives in its own file so nav.tsx and coach-badge.tsx can both use it
 * without importing each other in a cycle.
 *
 * Active state is what was missing entirely before — neither nav marked the
 * current page, so there was no way to tell where you were.
 */

import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

export type NavVariant = "bottom" | "side";

/** Pages that read `?tank=` — the dashboard's tank filter carries over between them. */
const TANK_SCOPED_PATHS = new Set(["/", "/calendar", "/coach"]);

/** `/tanks` stays active on `/tanks/3`; `/` only matches itself. */
export function useIsActive(href: string): boolean {
  const pathname = usePathname();
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

type NavItemProps = {
  href: string;
  label: string;
  icon: string;
  variant: NavVariant;
  /** overlay rendered on top of the icon (the Coach notification badge) */
  badge?: React.ReactNode;
};

function NavLink({ href, label, icon, variant, badge, active }: NavItemProps & { active: boolean }) {
  const bottom = variant === "bottom";
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={
        bottom
          ? "nav-item nav-item-bottom flex flex-col items-center justify-center gap-1 py-2 text-xs"
          : "nav-item nav-item-side flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm"
      }
      style={bottom ? { minHeight: 56 } : undefined}
    >
      <span className="relative flex">
        <i
          aria-hidden
          className={`ph${active ? "-fill" : ""} ph-${icon} ${bottom ? "text-xl" : "text-lg"}`}
        />
        {badge}
      </span>
      {label}
    </Link>
  );
}

/** Reads `?tank=` (useSearchParams needs a Suspense boundary — see NavItem below). */
function NavItemWithTank(props: NavItemProps) {
  const active = useIsActive(props.href);
  const tank = useSearchParams().get("tank");
  const finalHref = tank && TANK_SCOPED_PATHS.has(props.href) ? `${props.href}?tank=${tank}` : props.href;
  return <NavLink {...props} href={finalHref} active={active} />;
}

export function NavItem(props: NavItemProps) {
  const active = useIsActive(props.href);
  return (
    <Suspense fallback={<NavLink {...props} active={active} />}>
      <NavItemWithTank {...props} />
    </Suspense>
  );
}
