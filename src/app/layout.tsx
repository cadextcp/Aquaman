import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "@phosphor-icons/web/regular/style.css";
import "@phosphor-icons/web/fill/style.css";
import "./globals.css";
import { BottomNav, SideNav } from "@/components/nav";

/**
 * Nocturne typography (issue #43): Inter everywhere, self-hosted via
 * next/font (no CDN at runtime — Docker/offline safe). Phosphor icons
 * from the npm package for the same reason.
 */
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Aquaman — Aquarium Care",
  description:
    "Self-hosted aquarium care & water tracking with flexible scheduling and ICS calendar",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full flex flex">
        <div aria-hidden className="aqua-glow" />
        {/* Issue #21: nav lives HERE (root layout) so no page can lose it again */}
        <div className="flex min-h-dvh flex-1 min-w-0">
          <SideNav />
          {children}
        </div>
        <BottomNav />
      </body>
    </html>
  );
}
