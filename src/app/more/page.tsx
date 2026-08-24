import { headers } from "next/headers";
import { getOrCreateIcsToken } from "@/lib/ics-token";
import { IcsSettings } from "@/components/ics-settings";
import { isAiConfigured } from "@/lib/ai/config";
import { usageForSettings } from "@/lib/ai/cost-guard";

export const dynamic = "force-dynamic";

export default async function MorePage() {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const token = getOrCreateIcsToken();
  const icsUrl = `${proto}://${host}/api/calendar.ics?t=${token}`;

  const aiOn = isAiConfigured();
  const usage = usageForSettings();

  return (
    <main className="flex-1 pb-20 lg:pb-8 p-4 lg:p-8 max-w-3xl">
      <h1 className="text-2xl font-bold mb-6">More</h1>

      <div className="mb-4">
        <IcsSettings initialUrl={icsUrl} />
      </div>

      <div className="rounded-xl p-5 mb-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <div className="text-xs uppercase tracking-wide mb-2" style={{ color: "var(--muted-foreground)" }}>
          AI coach
        </div>
        {aiOn ? (
          <p className="text-sm">
            <span style={{ color: "var(--success)" }}>● Online</span> — usage today: {usage.calls} calls ·{" "}
            {usage.totalTokens.toLocaleString()} tokens. Daily limits reset at local midnight.
          </p>
        ) : (
          <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
            <span>○ Offline</span> — no <code>AQUAMAN_AI_API_KEY</code> configured. The app works fully without it.
          </p>
        )}
      </div>

      <div className="rounded-xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <p className="text-sm mb-3" style={{ color: "var(--muted-foreground)" }}>
          More features arrive in the next phases.
        </p>
        <ul className="text-sm space-y-2" style={{ color: "var(--muted-foreground)" }}>
          <li>⬇ Export/Import — Phase 5</li>
        </ul>
      </div>
    </main>
  );
}
