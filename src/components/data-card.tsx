"use client";

/**
 * Data card: JSON export download + import with double confirm (Phase 5).
 * Import replaces ALL user data (REPLACE semantics per PRD §5.9) — the UI
 * makes that unmistakable before anything is sent.
 */

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { importDataAction } from "@/app/actions-data";

export function DataCard() {
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
      setResult("File too large (max 20 MB)");
      setIsError(true);
      return;
    }
    // first confirm: explicit "replace everything" wording
    if (!confirm(`Import "${file.name}"?\n\nThis REPLACES all current data (tanks, schedules, logs, water tests, feeding history). There is no undo — export first if unsure.`)) {
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
          `Imported: ${d.tanks} tanks · ${d.schedules} schedules · ${d.maintenanceLogs} logs · ${d.waterTests} water tests · ${d.feedLogs} feed days · ${d.aiCalls} AI call records`,
        );
        setIsError(false);
        router.refresh();
      } else {
        setResult(res.ok ? "Import failed" : res.error);
        setIsError(true);
      }
    } catch (err) {
      setResult(err instanceof Error ? err.message : "Could not read file");
      setIsError(true);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="rounded-xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      <div className="text-xs uppercase tracking-wide mb-2" style={{ color: "var(--muted-foreground)" }}>
        Data — export / import
      </div>
      <p className="text-sm mb-3" style={{ color: "var(--muted-foreground)" }}>
        Your data is yours: export everything as JSON, or move a snapshot into a fresh instance. Secrets (tokens, API keys)
        are never part of an export.
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <a
          href="/api/export"
          download
          className="rounded-lg px-4 py-2.5 text-sm font-medium text-center"
          style={{ background: "var(--accent)", color: "#fff", minHeight: 44 }}
        >
          ⬇ Download JSON export
        </a>
        <label
          className="rounded-lg px-4 py-2.5 text-sm font-medium text-center cursor-pointer"
          style={{ background: "var(--secondary)", color: "var(--secondary-foreground)", minHeight: 44, opacity: busy ? 0.6 : 1 }}
        >
          {busy ? "Importing…" : "⬆ Import snapshot…"}
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={onFile} disabled={busy} />
        </label>
      </div>
      {result && (
        <p className="text-sm mt-3" style={{ color: isError ? "var(--destructive)" : "var(--success)" }}>
          {isError ? "✗ " : "✓ "}
          {result}
        </p>
      )}
    </div>
  );
}
