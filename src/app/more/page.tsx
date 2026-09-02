import Link from "next/link";
import { headers } from "next/headers";
import { getOrCreateIcsToken } from "@/lib/ics-token";
import { getOrCreateMcpToken } from "@/lib/mcp-token";
import { getOrCreateApiToken } from "@/lib/api-token";
import { IcsSettings } from "@/components/ics-settings";
import { McpSettings } from "@/components/mcp-settings";
import { ApiSettings } from "@/components/api-settings";
import { DataCard } from "@/components/data-card";
import { TightGapSettings } from "@/components/tightgap-settings";
import { LanguageSettings } from "@/components/language-settings";
import { AiProviderSettings } from "@/components/ai-provider-settings";
import { getGlobalSettings, getAiSettings } from "@/lib/settings";
import { isAiConfigured, hasApiKey } from "@/lib/ai/config";
import { usageForSettings } from "@/lib/ai/cost-guard";
import { monthlyStats, careReliabilityStats, chronicOverload, aiCostStats } from "@/lib/stats";
import { today } from "@/lib/domain/dates";
import { APP_VERSION } from "@/lib/version";
import { PageHeader } from "@/components/ui/page-header";
import { HelpDot, HelpNote } from "@/components/ui/help";
import { getLocale } from "@/lib/settings";
import { t, formatNumber, actionLabelFor } from "@/i18n";

export const dynamic = "force-dynamic";

function fmtMicros(micros: number): string {
  // cost estimates are micros of a currency unit — show 2 decimals of cents
  return `${(micros / 1_000_000).toFixed(3)}`;
}

export default async function MorePage() {
  const locale = getLocale();
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const token = getOrCreateIcsToken();
  const icsUrl = `${proto}://${host}/api/calendar.ics?t=${token}`;

  const aiOn = isAiConfigured();
  const usage = usageForSettings();
  const globals = getGlobalSettings();
  const aiSettings = getAiSettings();

  const thisMonth = today().slice(0, 7);
  const stats = monthlyStats(thisMonth);
  const reliability = careReliabilityStats();
  const overload = chronicOverload();
  const aiCost = aiCostStats(30);

  return (
    <main className="flex-1 pb-20 lg:pb-8 p-4 lg:p-8 max-w-3xl">
      <PageHeader
        title={t("more.title", locale)}
        action={
          <span className="text-xs tnum" style={{ color: "var(--muted-foreground)" }}>
            v{APP_VERSION}
          </span>
        }
      />

      <Link
        href="/more/concepts"
        className="rounded-xl p-4 mb-4 flex items-center gap-3 edge-card transition-colors hover:bg-white/[0.07]"
      >
        <i aria-hidden className="ph ph-compass text-xl" style={{ color: "var(--accent)" }} />
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium">{t("more.conceptsTitle", locale)}</span>
          <span className="block text-xs" style={{ color: "var(--muted-foreground)" }}>
            {t("more.conceptsDesc", locale)}
          </span>
        </span>
        <i aria-hidden className="ph ph-caret-right" style={{ color: "var(--faint)" }} />
      </Link>

      <Link
        href="/more/debug"
        className="rounded-xl p-4 mb-4 flex items-center gap-3 edge-card transition-colors hover:bg-white/[0.07]"
      >
        <i aria-hidden className="ph ph-bug text-xl" style={{ color: "var(--accent)" }} />
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium">{t("more.debugTitle", locale)}</span>
          <span className="block text-xs" style={{ color: "var(--muted-foreground)" }}>
            {t("more.debugDesc", locale)}
          </span>
        </span>
        <i aria-hidden className="ph ph-caret-right" style={{ color: "var(--faint)" }} />
      </Link>

      <div className="mb-4">
        <IcsSettings initialUrl={icsUrl} />
      </div>

      {/* MCP endpoint (product v1.1) */}
      <div className="mb-4">
        <McpSettings endpointUrl={`${proto}://${host}/api/mcp`} token={getOrCreateMcpToken()} />
      </div>

      {/* v1 REST API */}
      <div className="mb-4">
        <ApiSettings docsUrl={`${proto}://${host}/api/v1/docs`} token={getOrCreateApiToken()} />
      </div>

      {/* Statistics */}
      <div className="rounded-xl p-5 mb-4 edge-card">
        <div className="text-xs uppercase tracking-wide" style={{ color: "var(--muted-foreground)" }}>
          {t("more.thisMonth", locale, { month: thisMonth })}
        </div>
        <HelpNote id="timezone" className="mb-3 mt-0.5" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <Stat label={t("more.statWaterChanges", locale)} value={stats.waterChanges} />
          <Stat label={t("more.statFeedings", locale)} value={stats.feedings} />
          <Stat label={t("more.statWaterTests", locale)} value={stats.waterTests} />
          <Stat label={t("more.statOtherCare", locale)} value={stats.otherMaintenance} />
        </div>

        <div className="text-xs uppercase tracking-wide mb-2 flex items-center gap-0.5" style={{ color: "var(--muted-foreground)" }}>
          {t("more.medianTitle", locale)}
          <HelpDot id="medianDelay" />
        </div>
        <p className="text-xs mb-2" style={{ color: "var(--faint)" }}>
          {t("more.medianTarget", locale)}
        </p>
        {reliability.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
            {t("more.medianEmpty", locale)}
          </p>
        ) : (
          <ul className="text-sm space-y-1 mb-4">
            {reliability.map((r) => (
              <li key={r.actionType} className="flex justify-between">
                <span>{actionLabelFor(r.actionType, locale)}</span>
                <span style={{ color: "var(--muted-foreground)" }}>
                  {r.medianDelayDays === null ? "—" : t("more.medianValue", locale, { n: r.medianDelayDays })}{" "}
                  {t("more.medianCount", locale, { n: r.count })}
                </span>
              </li>
            ))}
          </ul>
        )}

        {overload.length > 0 && (
          <div className="rounded-lg p-3 text-sm mb-2" style={{ background: "var(--secondary)" }}>
            <div className="font-medium mb-1">{t("more.overloadTitle", locale, { n: overload.length })}</div>
            <ul className="space-y-0.5" style={{ color: "var(--muted-foreground)" }}>
              {overload.slice(0, 5).map((o) => (
                <li key={o.scheduleId}>
                  {t("more.overloadRow", locale, {
                    tank: o.tankName,
                    action: actionLabelFor(o.actionType, locale),
                    n: o.missedSlots,
                  })}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Language (global — UI, ICS titles, coach) */}
      <div className="mb-4">
        <LanguageSettings initialLocale={globals.locale} />
      </div>

      {/* Scheduling: after catching up (global) */}
      <div className="mb-4">
        <TightGapSettings initialPolicy={globals.tightGapPolicy} initialThreshold={globals.tightGapThresholdPct} />
      </div>

      {/* AI provider settings */}
      <div className="mb-4">
        <AiProviderSettings
          initial={aiSettings}
          envConfigured={!!process.env.AQUAMAN_AI_API_KEY}
          keyConfigured={hasApiKey()}
        />
      </div>

      {/* AI status + 30-day cost */}
      <div className="rounded-xl p-5 mb-4 edge-card">
        <div className="text-xs uppercase tracking-wide mb-2" style={{ color: "var(--muted-foreground)" }}>
          {t("more.aiTitle", locale)}
        </div>
        {aiOn ? (
          <p className="text-sm mb-2">
            <span className="inline-flex items-center gap-1.5" style={{ color: "var(--success)" }}>
              <i aria-hidden className="ph-fill ph-circle text-[8px]" /> {t("more.aiOnline", locale)}
            </span>{" "}
            — {t("more.aiOnlineDetail", locale, { calls: usage.calls, tokens: formatNumber(usage.totalTokens, locale) })}
          </p>
        ) : (
          <p className="text-sm mb-2" style={{ color: "var(--muted-foreground)" }}>
            <span className="inline-flex items-center gap-1.5">
              <i aria-hidden className="ph ph-circle text-[8px]" /> {t("more.aiOffline", locale)}
            </span>{" "}
            — {t("more.aiOfflineDetail", locale)}
          </p>
        )}
        <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
          {t("more.aiCost", locale, {
            calls: aiCost.calls,
            tokens: formatNumber(aiCost.promptTokens + aiCost.completionTokens, locale),
            cost: fmtMicros(aiCost.costMicros),
          })}
          {aiCost.byModel.length > 1 && ` (${aiCost.byModel.map((m) => `${m.model}: ${m.calls}`).join(", ")})`}
        </p>
        <HelpNote id="costUnits" />
      </div>

      {/* Data export/import */}
      <DataCard />
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="edge-card rounded-lg p-3">
      <div className="text-2xl font-medium tnum">{value}</div>
      <div className="text-[10px] uppercase tracking-wide mt-0.5" style={{ color: "var(--muted-foreground)" }}>
        {label}
      </div>
    </div>
  );
}
