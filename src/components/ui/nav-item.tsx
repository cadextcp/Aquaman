"use client";

/**
 * One nav link, shared by the bottom bar, the sidebar and the badged Coach
 * item. Lives in its own file so nav.tsx and coach-badge.tsx can both use it
 * without importing each other in a cycle.
 *
 * Active state is what was missing entirely before — neither nav marked the
 * current page, so there was no way to tell where you were.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavVariant = "bottom" | "side";

/** `/tanks` stays active on `/tanks/3`; `/` only matches itself. */
export function useIsActive(href: string): boolean {
  const pathname = usePathname();
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function NavItem({
  href,
  label,
  icon,
  variant,
  badge,
}: {
  href: string;
  label: string;
  icon: string;
  variant: NavVariant;
  /** overlay rendered on top of the icon (the Coach notification badge) */
  badge?: React.ReactNode;
}) {
  const active = useIsActive(href);
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
