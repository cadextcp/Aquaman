import { isAiConfigured } from "@/lib/ai/config";
import { usageForSettings } from "@/lib/ai/cost-guard";
import { CoachChat } from "@/components/coach-chat";
import { PageHeader } from "@/components/ui/page-header";

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
        action={
          configured && (
            <span className="text-xs tnum" style={{ color: "var(--muted-foreground)" }}>
              {usage.calls} call{usage.calls === 1 ? "" : "s"} today · {usage.totalTokens.toLocaleString()} tokens
            </span>
          )
        }
      />

      <CoachChat aiConfigured={configured} initialQuestion={q} />
    </main>
  );
}
