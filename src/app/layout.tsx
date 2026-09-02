import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "@phosphor-icons/web/regular/style.css";
import "@phosphor-icons/web/fill/style.css";
import "./globals.css";
import { BottomNav, SideNav } from "@/components/nav";
import { LocaleProvider } from "@/i18n/provider";
import { catalogFor, t } from "@/i18n";
import { getLocale } from "@/lib/settings";

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

export function generateMetadata(): Metadata {
  const locale = getLocale();
  return { title: t("app.title", locale), description: t("app.description", locale) };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // One language for the whole install (global setting, /more) — resolved here
  // so every server page AND the client provider below agree on it.
  const locale = getLocale();

  return (
    <html lang={locale} className={`${inter.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full flex flex">
        {/* only the ACTIVE locale's catalog crosses the wire, not every translation */}
        <LocaleProvider locale={locale} catalog={catalogFor(locale)}>
          <div aria-hidden className="aqua-glow" />
          {/* Issue #21: nav lives HERE (root layout) so no page can lose it again */}
          <div className="flex min-h-dvh flex-1 min-w-0">
            <SideNav />
            {children}
          </div>
          <BottomNav />
        </LocaleProvider>
      </body>
    </html>
  );
}
