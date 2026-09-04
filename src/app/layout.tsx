import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "@phosphor-icons/web/regular/style.css";
import "@phosphor-icons/web/fill/style.css";
import "./globals.css";
import { BottomNav, SideNav } from "@/components/nav";
import { ServiceWorkerRegistration } from "@/components/service-worker";
import { LocaleProvider } from "@/i18n/provider";
import { catalogFor, t } from "@/i18n";
import { getLocale } from "@/lib/settings";
import { THEME_COLOR } from "./manifest";

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

/**
 * Installed-app chrome (mobile plan, stage 0).
 *
 * `viewportFit: "cover"` is what activates the `env(safe-area-inset-*)` values
 * — without it they resolve to 0 and the bottom nav's existing safe-area
 * padding does nothing on an iPhone.
 *
 * statusBarStyle stays "default" (opaque) on purpose: "black-translucent" runs
 * the page under the clock, and no screen here reserves a top inset for that.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: THEME_COLOR,
  colorScheme: "dark",
};

export function generateMetadata(): Metadata {
  const locale = getLocale();
  return {
    title: t("app.title", locale),
    description: t("app.description", locale),
    // iOS ignores the manifest's icons and its display mode alike: the apple
    // touch icon is what lands on the home screen, appleWebApp.capable is what
    // makes the launch full-screen instead of opening Safari.
    icons: { apple: "/apple-touch-icon.png" },
    appleWebApp: { capable: true, statusBarStyle: "default", title: t("app.name", locale) },
    // `appleWebApp.capable` only emits the modern `mobile-web-app-capable`.
    // Older iOS reads the apple-prefixed name and, without it, launches the
    // home-screen icon into Safari with its chrome — which is the one thing
    // installing was supposed to remove.
    other: { "apple-mobile-web-app-capable": "yes" },
  };
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
          <ServiceWorkerRegistration />
        </LocaleProvider>
      </body>
    </html>
  );
}
