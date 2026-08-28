import { isAiConfigured } from "@/lib/ai/config";
import { usageForSettings } from "@/lib/ai/cost-guard";
import { CoachChat } from "@/components/coach-chat";
import { PageHeader } from "@/components/ui/page-header";
import { HelpDot, HelpNote } from "@/components/ui/help";

export const dynamic = "force-dynamic";

export default async function CoachPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const configured = isAiConfigured();
  const usage = usageForSettings();

  return (
    <main className="flex-1 pb-20 lg:pb-8 p-4 lg:p-8 max-w-3xl">
      <PageHeader
        title="Coach"
        adornment={<HelpDot id="aiData" />}
        action={
          configured && (
            <span className="text-xs tnum" style={{ color: "var(--muted-foreground)" }}>
              {usage.calls} call{usage.calls === 1 ? "" : "s"} today · {usage.totalTokens.toLocaleString()} tokens
            </span>
          )
        }
      />

      <div className="mb-4 rounded-xl px-3.5 py-2.5 edge-card">
        <HelpNote id="aiGate" className="mt-0" />
        <HelpNote id={configured ? "aiLimits" : "aiOffline"} className="mt-1" />
      </div>

      <CoachChat aiConfigured={configured} initialQuestion={q} />
    </main>
  );
}
