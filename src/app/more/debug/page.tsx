import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { listAiCallLogs } from "@/lib/ai/debug-log";

export const dynamic = "force-dynamic";

export const metadata = { title: "Debug — Aquaman" };

/**
 * Raw AI request/response trace (More → Debug). Reads the pruned
 * `ai_call_logs` table (see debug-log.ts) — most recent calls only, not a
 * permanent record. Nothing here is ever sent anywhere; it's a local
 * inspection aid.
 */
export default function DebugPage() {
  const logs = listAiCallLogs(50);

  return (
    <main className="flex-1 pb-20 lg:pb-8 p-4 lg:p-8 max-w-3xl">
      <PageHeader
        title="Debug"
        subtitle="Raw request/response of the last AI calls — coach, plan review, daily suggestions."
        action={
          <Link
            href="/more"
            className="btn-ghost inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm"
            style={{ minHeight: 44 }}
          >
            <i aria-hidden className="ph ph-caret-left" /> More
          </Link>
        }
      />

      {logs.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
          No AI calls logged yet. This fills in as soon as the coach, plan review, or daily
          suggestions talk to the provider.
        </p>
      ) : (
        <>
          <p className="text-xs mb-4" style={{ color: "var(--faint)" }}>
            Showing the {logs.length} most recent of up to 200 kept calls — oldest are dropped
            automatically.
          </p>
          <div className="flex flex-col gap-3">
            {logs.map((log) => (
              <LogEntry key={log.id} log={log} />
            ))}
          </div>
        </>
      )}
    </main>
  );
}

function LogEntry({
  log,
}: {
  log: {
    id: number;
    createdAt: string;
    purpose: string;
    provider: string;
    model: string;
    requestJson: string;
    responseJson: string | null;
    error: string | null;
    durationMs: number;
  };
}) {
  return (
    <div className="rounded-xl p-4 edge-card">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="text-xs px-2 py-0.5 rounded-full uppercase tracking-wide"
            style={{ background: "var(--secondary)", color: "var(--secondary-foreground)" }}
          >
            {log.purpose}
          </span>
          <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>
            {log.provider} · {log.model}
          </span>
          {log.error && (
            <span
              className="text-xs px-2 py-0.5 rounded-full"
              style={{ background: "var(--destructive-soft)", color: "var(--destructive)", boxShadow: "inset 0 0 0 1px var(--destructive-edge)" }}
            >
              error
            </span>
          )}
        </div>
        <span className="text-xs tnum" style={{ color: "var(--faint)" }}>
          {formatTimestamp(log.createdAt)} · {log.durationMs} ms
        </span>
      </div>

      {log.error && (
        <p className="text-sm mb-2" style={{ color: "var(--destructive)" }}>
          {log.error}
        </p>
      )}

      <details className="mb-1.5">
        <summary className="text-xs cursor-pointer select-none" style={{ color: "var(--muted-foreground)" }}>
          Request
        </summary>
        <pre className="text-xs mt-1.5 p-2.5 rounded-lg overflow-x-auto whitespace-pre-wrap break-words font-mono" style={{ background: "var(--secondary)" }}>
          {formatJson(log.requestJson)}
        </pre>
      </details>

      <details>
        <summary className="text-xs cursor-pointer select-none" style={{ color: "var(--muted-foreground)" }}>
          Response
        </summary>
        <pre className="text-xs mt-1.5 p-2.5 rounded-lg overflow-x-auto whitespace-pre-wrap break-words font-mono" style={{ background: "var(--secondary)" }}>
          {log.responseJson ? formatJson(log.responseJson) : "(no response — call failed before completion)"}
        </pre>
      </details>
    </div>
  );
}

function formatJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}
