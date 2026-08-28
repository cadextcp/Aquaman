import { headers } from "next/headers";
import { getOrCreateIcsToken } from "@/lib/ics-token";
import { getOrCreateMcpToken } from "@/lib/mcp-token";
import { IcsSettings } from "@/components/ics-settings";
import { McpSettings } from "@/components/mcp-settings";
import { DataCard } from "@/components/data-card";
import { TightGapSettings } from "@/components/tightgap-settings";
import { AiProviderSettings } from "@/components/ai-provider-settings";
import { getGlobalSettings, getAiSettings } from "@/lib/settings";
import { isAiConfigured } from "@/lib/ai/config";
import { usageForSettings } from "@/lib/ai/cost-guard";
import { monthlyStats, careReliabilityStats, chronicOverload, aiCostStats } from "@/lib/stats";
import { today, shiftMonth } from "@/lib/domain/dates";
import { APP_VERSION } from "@/lib/version";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

function fmtMicros(micros: number): string {
  // cost estimates are micros of a currency unit — show 2 decimals of cents
  return `${(micros / 1_000_000).toFixed(3)}`;
}

export default async function MorePage() {
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
        title="More"
        action={
          <span className="text-xs tnum" style={{ color: "var(--muted-foreground)" }}>
            v{APP_VERSION}
          </span>
        }
      />

      <div className="mb-4">
        <IcsSettings initialUrl={icsUrl} />
      </div>

      {/* MCP endpoint (product v1.1) */}
      <div className="mb-4">
        <McpSettings endpointUrl={`${proto}://${host}/api/mcp`} token={getOrCreateMcpToken()} />
      </div>

      {/* Statistics */}
      <div className="rounded-xl p-5 mb-4 edge-card">
        <div className="text-xs uppercase tracking-wide mb-3" style={{ color: "var(--muted-foreground)" }}>
          This month ({thisMonth})
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <Stat label="Water changes" value={stats.waterChanges} />
          <Stat label="Feedings" value={stats.feedings} />
          <Stat label="Water tests" value={stats.waterTests} />
          <Stat label="Other care" value={stats.otherMaintenance} />
        </div>

        <div className="text-xs uppercase tracking-wide mb-2" style={{ color: "var(--muted-foreground)" }}>
          Median delay by plan
        </div>
        <p className="text-xs mb-2" style={{ color: "var(--faint)" }}>
          target &lt; 2 d water change · &lt; 1 d fertilize
        </p>
        {reliability.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
            No completed tasks yet — check tasks off and this fills in.
          </p>
        ) : (
          <ul className="text-sm space-y-1 mb-4">
            {reliability.map((r) => (
              <li key={r.actionType} className="flex justify-between">
                <span>{r.actionType.replace(/_/g, " ")}</span>
                <span style={{ color: "var(--muted-foreground)" }}>
                  {r.medianDelayDays === null ? "—" : `${r.medianDelayDays} d median`} ({r.count}×)
                </span>
              </li>
            ))}
          </ul>
        )}

        {overload.length > 0 && (
          <div className="rounded-lg p-3 text-sm mb-2" style={{ background: "var(--secondary)" }}>
            <div className="font-medium mb-1">Interval too tight? ({overload.length})</div>
            <ul className="space-y-0.5" style={{ color: "var(--muted-foreground)" }}>
              {overload.slice(0, 5).map((o) => (
                <li key={o.scheduleId}>
                  {o.tankName} · {o.actionType.replace(/_/g, " ")} — {o.missedSlots} missed slots
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Scheduling: after catching up (global) */}
      <div className="mb-4">
        <TightGapSettings initialPolicy={globals.tightGapPolicy} initialThreshold={globals.tightGapThresholdPct} />
      </div>

      {/* AI provider settings */}
      <div className="mb-4">
        <AiProviderSettings initial={aiSettings} envConfigured={!!process.env.AQUAMAN_AI_API_KEY} />
      </div>

      {/* AI status + 30-day cost */}
      <div className="rounded-xl p-5 mb-4 edge-card">
        <div className="text-xs uppercase tracking-wide mb-2" style={{ color: "var(--muted-foreground)" }}>
          AI coach
        </div>
        {aiOn ? (
          <p className="text-sm mb-2">
            <span className="inline-flex items-center gap-1.5" style={{ color: "var(--success)" }}><i aria-hidden className="ph-fill ph-circle text-[8px]" /> Online</span> — today: {usage.calls} calls ·{" "}
            {usage.totalTokens.toLocaleString()} tokens. Daily limits reset at local midnight.
          </p>
        ) : (
          <p className="text-sm mb-2" style={{ color: "var(--muted-foreground)" }}>
            <span className="inline-flex items-center gap-1.5"><i aria-hidden className="ph ph-circle text-[8px]" /> Offline</span> — no <code>AQUAMAN_AI_API_KEY</code> configured. The app works fully without it.
          </p>
        )}
        <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
          Last 30 days: {aiCost.calls} calls · {(aiCost.promptTokens + aiCost.completionTokens).toLocaleString()} tokens · ≈
          {fmtMicros(aiCost.costMicros)} cost units
          {aiCost.byModel.length > 1 && ` (${aiCost.byModel.map((m) => `${m.model}: ${m.calls}`).join(", ")})`}
        </p>
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
