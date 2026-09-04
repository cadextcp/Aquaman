/**
 * Web app manifest — what turns "Add to Home Screen" into a standalone app
 * instead of a browser bookmark (mobile plan, stage 0).
 *
 * A route rather than a static public/manifest.json so the install's language
 * setting reaches the launcher: the name under the icon follows /more, like
 * every other user-visible string. getLocale() falls back to the env default
 * when no DB exists yet (see lib/settings.ts), so the build-time prerender of
 * this route works on a fresh checkout.
 */
import type { MetadataRoute } from "next";
import { t } from "@/i18n";
import { getLocale } from "@/lib/settings";

/** Keep in sync with --background in globals.css (and scripts/generate-icons.mjs). */
export const THEME_COLOR = "#0f111c";

/**
 * Without this Next prerenders the manifest at build time, where getLocale()
 * has no DB and falls back to the env default — freezing the launcher name in
 * whatever locale CI happened to build with, for every install.
 */
export const dynamic = "force-dynamic";

export default function manifest(): MetadataRoute.Manifest {
  const locale = getLocale();

  return {
    name: t("app.title", locale),
    short_name: t("app.name", locale),
    description: t("app.description", locale),
    lang: locale,
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: THEME_COLOR,
    theme_color: THEME_COLOR,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Android crops adaptive icons to a circle inside the inner 80% — a
      // full-bleed "any" icon would lose its edges to that mask.
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
