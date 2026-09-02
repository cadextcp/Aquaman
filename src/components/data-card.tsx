"use client";

/**
 * Data card: JSON export download + import with double confirm (Phase 5).
 * Import replaces ALL user data (REPLACE semantics per PRD §5.9) — the UI
 * makes that unmistakable before anything is sent.
 */

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { importDataAction } from "@/app/actions-data";
import { StatusNote } from "./ui/status-note";
import { useI18n } from "@/i18n/provider";

export function DataCard() {
  const { t, errorText } = useI18n();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setResult(null);
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      setResult(t("settings.data.tooLarge"));
      setIsError(true);
      return;
    }
    // first confirm: explicit "replace everything" wording
    if (!confirm(t("settings.data.importConfirm", { file: file.name }))) {
      e.target.value = "";
      return;
    }
    setBusy(true);
    try {
      const text = await file.text();
      const data = JSON.parse(text) as unknown;
      const res = await importDataAction(data);
      if (res.ok && res.data) {
        const d = res.data;
        setResult(
          t("settings.data.imported", {
            tanks: d.tanks,
            schedules: d.schedules,
            logs: d.maintenanceLogs,
            waterTests: d.waterTests,
            feedDays: d.feedLogs,
            aiCalls: d.aiCalls,
          }),
        );
        setIsError(false);
        router.refresh();
      } else {
        setResult(res.ok ? t("settings.data.importFailed") : errorText(res));
        setIsError(true);
      }
    } catch (err) {
      setResult(err instanceof Error ? err.message : t("settings.data.readFailed"));
      setIsError(true);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="rounded-xl p-5 edge-card">
      <div className="text-xs uppercase tracking-wide mb-2" style={{ color: "var(--muted-foreground)" }}>
        {t("settings.data.title")}
      </div>
      <p className="text-sm mb-3" style={{ color: "var(--muted-foreground)" }}>
        {t("settings.data.description")}
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <a
          href="/api/export"
          download
          className="btn-outline inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-medium"
          style={{ minHeight: 44 }}
        >
          <i aria-hidden className="ph ph-download-simple" /> {t("settings.data.export")}
        </a>
        <label
          className="btn-ghost inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-medium"
          style={{ minHeight: 44, opacity: busy ? 0.6 : 1 }}
        >
          {busy ? t("settings.data.importing") : <><i aria-hidden className="ph ph-upload-simple" /> {t("settings.data.import")}</>}
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={onFile} disabled={busy} />
        </label>
      </div>
      {result && (
        <p className="mt-3">
          <StatusNote tone={isError ? "error" : "success"}>{result}</StatusNote>
        </p>
      )}
    </div>
  );
}
