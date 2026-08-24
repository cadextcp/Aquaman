"use client";

/**
 * Water test form (issue #35): preset chips per parameter next to the free
 * numeric input (chips set the value; typing stays possible = custom), edit
 * mode pre-fills from an existing measurement. Delete lives in the history
 * list (WaterTestHistory), not here.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { logWaterTest, updateWaterTest } from "@/app/actions";

/** Common quick-pick values per parameter key (freshwater + shared). */
const PRESETS: Record<string, (string | number)[]> = {
  temp: [24, 25, 26],
  ph: [6.5, 7.0, 7.5],
  kh: [4, 6, 8],
  gh: [6, 8, 12],
  co2: [20, 25, 30],
  no2: [0, 0.05],
  no3: [5, 10, 25, 50],
  nh4: [0, 0.25, 0.5],
  po4: [0.1, 0.5, 1.0],
  fe: [0.05, 0.1, 0.3],
  cl2: [0],
  o2: [6, 8],
  salinity: [1.023, 1.024, 1.025],
  ca: [400, 420, 450],
  mg: [1250, 1300, 1350],
  alkalinity: [7, 9, 11],
};

export type WaterTestEditData = {
  id: number;
  measuredAt: string;
  values: Record<string, number | null>;
  note: string | null;
};

export function WaterTestForm({
  tankId,
  ranges,
  edit,
  onDone,
}: {
  tankId: number;
  ranges: { key: string; label: string; unit: string }[];
  /** when set: edit an existing measurement instead of creating one */
  edit?: WaterTestEditData;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(
    edit ? Object.fromEntries(Object.entries(edit.values).filter(([, v]) => v !== null).map(([k, v]) => [k, String(v)])) : {},
  );
  const [note, setNote] = useState(edit?.note ?? "");
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
    const res = edit
      ? await updateWaterTest({ id: edit.id, tankId, values: cleaned, note: note || undefined, measuredAt: edit.measuredAt })
      : await logWaterTest({ tankId, values: cleaned, note: note || undefined });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setOk(true);
    setValues({});
    setNote("");
    startTransition(() => router.refresh());
    if (onDone) onDone();
  }

  const input = { background: "var(--secondary)", border: "1px solid var(--border)", color: "inherit" };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <div className="text-sm" style={{ color: "var(--destructive)" }}>{error}</div>}
      {ok && <div className="text-sm" style={{ color: "var(--success)" }}>✓ Saved</div>}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {ranges.map((r) => {
          const presets = PRESETS[r.key] ?? [];
          const current = values[r.key] ?? "";
          return (
            <div key={r.key}>
              <label className="block text-xs mb-1" style={{ color: "var(--muted-foreground)" }}>
                {r.label} {r.unit && `(${r.unit})`}
              </label>
              <div className="flex items-center gap-1.5">
                <input inputMode="decimal" className="flex-1 min-w-0 rounded-lg px-2.5 py-2 text-sm"
                  style={input} placeholder="custom" value={current}
                  onChange={(e) => setValues((v) => ({ ...v, [r.key]: e.target.value }))} />
                {presets.map((p) => (
                  <button key={p} type="button"
                    onClick={() => setValues((v) => ({ ...v, [r.key]: String(p) }))}
                    className="rounded-md px-2 py-1.5 text-xs font-medium whitespace-nowrap"
                    style={{
                      background: current !== "" && Number(current.replace(",", ".")) === Number(p) ? "var(--primary)" : "var(--secondary)",
                      color: current !== "" && Number(current.replace(",", ".")) === Number(p) ? "var(--primary-foreground)" : "var(--secondary-foreground)",
                      cursor: "pointer",
                    }}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <input className="w-full rounded-lg px-3 py-2.5 text-sm" style={input} placeholder="Note (optional)"
        value={note} onChange={(e) => setNote(e.target.value)} />

      <div className="flex gap-2">
        <button type="submit" disabled={pending}
          className="rounded-lg px-5 py-2.5 text-sm font-medium"
          style={{ background: "var(--primary)", color: "var(--primary-foreground)", minHeight: 44, cursor: "pointer" }}>
          {edit ? "Save changes" : "Save test"}
        </button>
        {edit && onDone && (
          <button type="button" onClick={onDone}
            className="rounded-lg px-5 py-2.5 text-sm"
            style={{ border: "1px solid var(--border)", minHeight: 44, cursor: "pointer" }}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
