"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { logWaterTest } from "@/app/actions";

export function WaterTestForm({
  tankId,
  ranges,
}: {
  tankId: number;
  ranges: { key: string; label: string; unit: string }[];
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, startTransition] = useTransition();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(false);
    const cleaned: Record<string, number | null> = {};
    for (const [k, v] of Object.entries(values)) {
      if (v === "" || v === undefined) continue;
      const n = Number(v.replace(",", "."));
      if (Number.isNaN(n)) continue;
      cleaned[k] = n;
    }
    if (Object.keys(cleaned).length === 0) {
      setError("Enter at least one value");
      return;
    }
    const res = await logWaterTest({ tankId, values: cleaned, note: note || undefined });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setOk(true);
    setValues({});
    setNote("");
    startTransition(() => router.refresh());
  }

  const input = { background: "var(--secondary)", border: "1px solid var(--border)", color: "inherit" };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <div className="text-sm" style={{ color: "var(--destructive)" }}>{error}</div>}
      {ok && <div className="text-sm" style={{ color: "var(--success)" }}>✓ Saved</div>}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {ranges.map((r) => (
          <label key={r.key} className="text-xs" style={{ color: "var(--muted-foreground)" }}>
            {r.label} {r.unit && `(${r.unit})`}
            <input inputMode="decimal" className="mt-1 w-full rounded-lg px-2.5 py-2 text-sm"
              style={input} placeholder="—"
              value={values[r.key] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [r.key]: e.target.value }))} />
          </label>
        ))}
      </div>

      <input className="w-full rounded-lg px-3 py-2.5 text-sm" style={input} placeholder="Note (optional)"
        value={note} onChange={(e) => setNote(e.target.value)} />

      <button type="submit" disabled={pending}
        className="rounded-lg px-5 py-2.5 text-sm font-medium"
        style={{ background: "var(--primary)", color: "var(--primary-foreground)", minHeight: 44 }}>
        Save test
      </button>
    </form>
  );
}
