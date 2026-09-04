import { PageHeader } from "@/components/ui/page-header";
import { t } from "@/i18n";
import { getLocale } from "@/lib/settings";

/**
 * What the installed app shows when the NAS is out of reach (mobile plan,
 * stage 0). public/sw.js precaches this page and serves it for any navigation
 * that cannot reach the server.
 *
 * Reachable in the browser too, which is what keeps it honest: it is a normal
 * page, translated like every other, not a string baked into the worker.
 *
 * force-dynamic so the copy follows the language setting — a build-time
 * prerender would freeze the offline screen in whatever locale CI used.
 */
export const dynamic = "force-dynamic";

export default function OfflinePage() {
  const locale = getLocale();

  return (
    <main className="flex-1 pb-20 lg:pb-8 p-4 lg:p-8 max-w-3xl">
      <PageHeader title={t("offline.title", locale)} subtitle={t("offline.subtitle", locale)} />

      <div
        className="rounded-lg p-5 flex flex-col items-start gap-3"
        style={{ background: "var(--surface)", border: "1px solid var(--surface-edge)" }}
      >
        <i aria-hidden className="ph ph-wifi-slash text-3xl" style={{ color: "var(--muted-foreground)" }} />
        <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
          {t("offline.body", locale)}
        </p>
        <p className="text-sm" style={{ color: "var(--faint)" }}>
          {t("offline.hint", locale)}
        </p>
        {/*
          A plain <a>, not <Link>, on purpose: a client-side navigation fetches
          an RSC payload from the very server we just failed to reach, so it
          would stall instead of retrying. A hard navigation either loads the
          app or lands back here — which is what "try again" has to mean.
        */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href="/"
          className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium"
          style={{ background: "var(--accent-soft)", border: "1px solid var(--accent-edge)", color: "var(--accent-light)" }}
        >
          <i aria-hidden className="ph ph-arrow-clockwise" />
          {t("offline.retry", locale)}
        </a>
      </div>
    </main>
  );
}
