import Link from "next/link";
import { isAiConfigured } from "@/lib/ai/config";
import { usageForSettings } from "@/lib/ai/cost-guard";
import { listTanks } from "@/lib/repo";
import { CoachChat } from "@/components/coach-chat";
import { TankFilterBar } from "@/components/tank-filter-bar";
import { PageHeader } from "@/components/ui/page-header";
import { HelpDot, HelpNote } from "@/components/ui/help";
import { getLocale } from "@/lib/settings";
import { t, plural, formatNumber } from "@/i18n";

export const dynamic = "force-dynamic";

export default async function CoachPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; tank?: string }>;
}) {
  const { q, tank: tankParam } = await searchParams;
  const locale = getLocale();
  const configured = isAiConfigured();
  const usage = usageForSettings();
  const tanks = listTanks();
  // The coach always talks about exactly ONE tank — never "all", never both
  // at once. A missing/invalid/stale ?tank= (e.g. carried over from the
  // dashboard's "All tanks" view, or a deleted tank) falls back to the first
  // tank rather than leaving the coach without a subject.
  const selectedTankId = tankParam && tanks.some((tk) => String(tk.id) === tankParam) ? Number(tankParam) : (tanks[0]?.id ?? null);
  const selectedTank = tanks.find((tk) => tk.id === selectedTankId) ?? null;

  return (
    <main className="flex-1 pb-20 lg:pb-8 p-4 lg:p-8 max-w-3xl">
      <PageHeader
        title={t("coach.title", locale)}
        adornment={<HelpDot id="aiData" />}
        action={
          configured && (
            <span className="text-xs tnum" style={{ color: "var(--muted-foreground)" }}>
              {plural("coach.usage", usage.calls, locale, { tokens: formatNumber(usage.totalTokens, locale) })}
            </span>
          )
        }
      />

      <div className="mb-4 rounded-xl px-3.5 py-2.5 edge-card">
        <HelpNote id="aiGate" className="mt-0" />
        <HelpNote id={configured ? "aiLimits" : "aiOffline"} className="mt-1" />
      </div>

      {tanks.length === 0 ? (
        <div className="rounded-xl p-8 text-center edge-card">
          <i aria-hidden className="ph ph-fish text-4xl" style={{ color: "var(--faint)" }} />
          <p className="mb-4 mt-3" style={{ color: "var(--muted-foreground)" }}>
            {t("coach.noTanks", locale)}
          </p>
          <Link
            href="/tanks/new"
            className="btn-outline inline-flex items-center gap-1.5 rounded-lg px-5 py-2.5 text-sm font-medium"
            style={{ minHeight: 44 }}
          >
            <i aria-hidden className="ph ph-plus" /> {t("coach.createTank", locale)}
          </Link>
        </div>
      ) : (
        <>
          {/* One tank, never "all" — the coach only ever sees and discusses this tank */}
          <TankFilterBar
            tanks={tanks}
            selectedTankId={selectedTankId}
            hrefFor={(id) => `/coach?tank=${id}`}
            allowAll={false}
            locale={locale}
          />
          {/* key={selectedTankId}: switching tanks starts a fresh conversation —
              carrying old messages across a tank switch would leak the previous
              tank's context into the new one via the chat history itself. */}
          <CoachChat key={selectedTankId} aiConfigured={configured} initialQuestion={q} tankId={selectedTank!.id} />
        </>
      )}
    </main>
  );
}
