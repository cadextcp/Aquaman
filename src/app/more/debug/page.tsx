import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { listAiCallLogs } from "@/lib/ai/debug-log";
import { getLocale } from "@/lib/settings";
import { t, formatDateTime, type Locale } from "@/i18n";

export const dynamic = "force-dynamic";

export function generateMetadata() {
  const locale = getLocale();
  return { title: t("app.pageTitle", locale, { page: t("debug.title", locale) }) };
}

/**
 * Raw AI request/response trace (More → Debug). Reads the pruned
 * `ai_call_logs` table (see debug-log.ts) — most recent calls only, not a
 * permanent record. Nothing here is ever sent anywhere; it's a local
 * inspection aid.
 */
export default function DebugPage() {
  const locale = getLocale();
  const logs = listAiCallLogs(50);

  return (
    <main className="flex-1 pb-20 lg:pb-8 p-4 lg:p-8 max-w-3xl">
      <PageHeader
        title={t("debug.title", locale)}
        subtitle={t("debug.subtitle", locale)}
        action={
          <Link
            href="/more"
            className="btn-ghost inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm"
            style={{ minHeight: 44 }}
          >
            <i aria-hidden className="ph ph-caret-left" /> {t("common.back", locale)}
          </Link>
        }
      />

      {logs.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
          {t("debug.empty", locale)}
        </p>
      ) : (
        <>
          <p className="text-xs mb-4" style={{ color: "var(--faint)" }}>
            {t("debug.showing", locale, { n: logs.length })}
          </p>
          <div className="flex flex-col gap-3">
            {logs.map((log) => (
              <LogEntry key={log.id} log={log} locale={locale} />
            ))}
          </div>
        </>
      )}
    </main>
  );
}

function LogEntry({
  log,
  locale,
}: {
  locale: Locale;
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
              {t("debug.error", locale)}
            </span>
          )}
        </div>
        <span className="text-xs tnum" style={{ color: "var(--faint)" }}>
          {formatTimestamp(log.createdAt, locale)} · {log.durationMs} ms
        </span>
      </div>

      {log.error && (
        <p className="text-sm mb-2" style={{ color: "var(--destructive)" }}>
          {log.error}
        </p>
      )}

      <details className="mb-1.5">
        <summary className="text-xs cursor-pointer select-none" style={{ color: "var(--muted-foreground)" }}>
          {t("debug.request", locale)}
        </summary>
        <pre className="text-xs mt-1.5 p-2.5 rounded-lg overflow-x-auto whitespace-pre-wrap break-words font-mono" style={{ background: "var(--secondary)" }}>
          {formatJson(log.requestJson)}
        </pre>
      </details>

      <details>
        <summary className="text-xs cursor-pointer select-none" style={{ color: "var(--muted-foreground)" }}>
          {t("debug.response", locale)}
        </summary>
        <pre className="text-xs mt-1.5 p-2.5 rounded-lg overflow-x-auto whitespace-pre-wrap break-words font-mono" style={{ background: "var(--secondary)" }}>
          {log.responseJson ? formatJson(log.responseJson) : t("debug.noResponse", locale)}
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

function formatTimestamp(iso: string, locale: Locale): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return formatDateTime(iso, locale);
}
