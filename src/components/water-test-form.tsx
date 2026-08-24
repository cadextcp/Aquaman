"use client";

/**
 * Nocturne water test form (issue #43): one row per parameter with
 * - the value + unit and its status color
 * - a mini band scale (warn range → target band → warn range) with a marker
 * - delta vs the last measurement (▲ +0.2)
 * - a dropdown with preset options, each showing its band verdict
 *   (in band / off band / critical) — plus custom typing and clear.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { logWaterTest, updateWaterTest } from "@/app/actions";

/** Preset quick-picks per parameter (from the design's PARAMS list). */
const PRESETS: Record<string, number[]> = {
  temp: [22, 23, 24, 24.5, 25, 25.5, 26, 27, 28],
  ph: [6, 6.4, 6.5, 6.8, 7, 7.2, 7.5, 7.8, 8],
  kh: [3, 4, 5, 6, 7, 8, 9, 10],
  gh: [4, 6, 8, 10, 12, 14, 16],
  co2: [10, 15, 20, 25, 30, 35],
  no2: [0, 0.025, 0.05, 0.1, 0.2, 0.4],
  no3: [2, 5, 10, 15, 25, 40, 50, 80],
  nh4: [0, 0.1, 0.25, 0.5, 0.75, 1, 2],
  po4: [0.1, 0.25, 0.5, 1, 1.5, 2],
  fe: [0.05, 0.1, 0.2, 0.3, 0.4, 0.5],
  cl2: [0, 0.02, 0.05, 0.1],
  o2: [4, 5, 6, 7, 8, 10, 12],
  salinity: [1.023, 1.024, 1.025],
  ca: [400, 420, 450],
  mg: [1250, 1300, 1350],
  alkalinity: [7, 9, 11],
};

type RangeLike = { key: string; label: string; unit: string; min: number; max: number; warnMin?: number; warnMax?: number };

function statusOf(r: RangeLike, v: number | null): "ok" | "warn" | "critical" | "none" {
  if (v === null || v === undefined) return "none";
  if (r.warnMin !== undefined && v < r.warnMin) return "critical";
  if (r.warnMax !== undefined && v > r.warnMax) return "critical";
  if (v < r.min || v > r.max) return "warn";
  return "ok";
}

const COL: Record<string, string> = {
  ok: "var(--success)",
  warn: "var(--warning)",
  critical: "var(--destructive)",
  none: "var(--faint)",
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
  lastValues,
  onDone,
}: {
  tankId: number;
  ranges: RangeLike[];
  edit?: WaterTestEditData;
  /** previous measurement for the delta labels */
  lastValues?: Record<string, number | null>;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(
    edit
      ? Object.fromEntries(Object.entries(edit.values).filter(([, v]) => v !== null).map(([k, v]) => [k, String(v)]))
      : {},
  );
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState(edit?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const filled = ranges.filter((r) => values[r.key] !== undefined && values[r.key] !== "").length;

  function pick(key: string, v: number) {
    setValues((s) => ({ ...s, [key]: String(v) }));
    setOpen(null);
  }
  function clear(key: string) {
    setValues((s) => {
      const c = { ...s };
      delete c[key];
      return c;
    });
    setOpen(null);
  }
  function typeValue(key: string, raw: string) {
    setDraft(raw);
    const n = Number(raw.replace(",", "."));
    setValues((s) => (raw === "" || Number.isNaN(n) ? { ...s, [key]: raw } : { ...s, [key]: String(n) }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
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
    setSaved(true);
    setValues({});
    setNote("");
    startTransition(() => router.refresh());
    if (onDone) onDone();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2.5">
      <div className="flex items-baseline justify-between">
        <span className="text-xs uppercase tracking-widest" style={{ color: "var(--muted-foreground)" }}>
          Water test
        </span>
        <span className="text-xs tnum" style={{ color: "var(--faint)" }}>
          {filled}/{ranges.length} values
        </span>
      </div>

      {error && <div className="text-sm" style={{ color: "var(--destructive)" }}>{error}</div>}

      <div className="flex flex-col gap-2">
        {ranges.map((r) => {
          const raw = values[r.key];
          const num = raw !== undefined && raw !== "" ? Number(raw.replace(",", ".")) : null;
          const st = statusOf(r, num);
          const presets = PRESETS[r.key] ?? [];
          const last = lastValues?.[r.key] ?? null;
          const delta = num !== null && last !== null && last !== undefined ? Math.round((num - last) * 100) / 100 : null;

          // band scale geometry (warnMin..warnMax window, or padded min/max)
          const lo = r.warnMin !== undefined ? r.warnMin : r.min - Math.max(r.max - r.min, 0.1) * 0.6;
          const hi = r.warnMax !== undefined ? r.warnMax : r.max + Math.max(r.max - r.min, 0.1) * 0.6;
          const pct = (x: number) => Math.max(0, Math.min(100, ((x - lo) / (hi - lo)) * 100));
          const bandLeft = pct(r.min);
          const bandW = Math.max(2, pct(r.max) - pct(r.min));
          const marker = num !== null ? pct(num) : null;

          return (
            <div
              key={r.key}
              className="rounded-lg px-3 py-2"
              style={{
                background: st === "critical" ? "var(--destructive-soft)" : st === "warn" ? "var(--warning-soft)" : "rgba(233,233,237,0.04)",
                boxShadow: `inset 0 0 0 1px ${st === "critical" ? "var(--destructive-edge)" : st === "warn" ? "var(--warning-edge)" : "rgba(233,233,237,0.07)"}`,
              }}
            >
              <div className="flex items-center gap-2.5">
                <span className="text-sm w-14 shrink-0">{r.label}</span>

                {/* band mini-scale */}
                <span className="relative flex-1 h-4 hidden sm:block" aria-hidden>
                  <span className="absolute inset-y-1.5 left-0 right-0 rounded-full" style={{ background: "rgba(233,233,237,0.08)" }} />
                  <span
                    className="absolute inset-y-1.5 rounded-full"
                    style={{ left: `${bandLeft}%`, width: `${bandW}%`, background: "rgba(74,222,128,0.35)" }}
                  />
                  {marker !== null && (
                    <span
                      className="absolute top-0 bottom-0 rounded-full"
                      style={{ left: `calc(${marker}% - 2px)`, width: 4, background: COL[st], boxShadow: "0 0 6px " + COL[st] }}
                    />
                  )}
                </span>

                {/* value + delta */}
                <span className="text-sm tnum w-20 text-right" style={{ color: num === null ? "var(--faint)" : "var(--foreground)" }}>
                  {num === null ? "not measured" : num}
                </span>
                <span className="text-[10px] tnum w-12 shrink-0" style={{ color: delta === null ? "transparent" : "rgba(233,233,237,0.4)" }}>
                  {delta === null ? "·" : delta === 0 ? "= 0" : `${delta > 0 ? "▲ +" : "▼"}${Math.abs(delta)}`}
                </span>

                {/* dropdown toggle */}
                <button
                  type="button"
                  onClick={() => {
                    setOpen(open === r.key ? null : r.key);
                    setDraft("");
                  }}
                  className="rounded-md shrink-0"
                  style={{ width: 30, height: 26, background: "rgba(233,233,237,0.05)", boxShadow: "inset 0 0 0 1px rgba(233,233,237,0.12)", color: "var(--secondary-foreground)", cursor: "pointer" }}
                  aria-label={`Choose ${r.label} value`}
                >
                  <i aria-hidden className={`ph ph-caret-${open === r.key ? "up" : "down"}`} />
                </button>
              </div>

              {/* band label row */}
              <div className="flex justify-between mt-1 text-[10px] tnum" style={{ color: "var(--faint)" }}>
                <span>{r.min === r.max ? String(r.min) : `${r.min}–${r.max}`} {r.unit}</span>
                {num !== null && <span style={{ color: COL[st] }}>{st === "ok" ? "in band" : st === "warn" ? "off band" : "critical"}</span>}
              </div>

              {/* preset dropdown */}
              {open === r.key && (
                <div className="mt-2 rounded-lg p-1.5" style={{ background: "var(--card-raised)", boxShadow: "inset 0 0 0 1px var(--border)" }}>
                  <div className="flex flex-wrap gap-1">
                    {presets.map((o) => {
                      const ost = statusOf(r, o);
                      const selected = num === o;
                      return (
                        <button
                          key={o}
                          type="button"
                          onClick={() => pick(r.key, o)}
                          className="rounded-md px-2 py-1.5 text-xs tnum flex items-center gap-1.5"
                          style={{
                            background: selected ? "rgba(145,132,217,0.2)" : "transparent",
                            color: selected ? "var(--foreground)" : "rgba(233,233,237,0.8)",
                            cursor: "pointer",
                          }}
                        >
                          {o}
                          <span
                            className="inline-block rounded-full"
                            style={{ width: 5, height: 5, background: ost === "ok" ? "var(--success)" : ost === "warn" ? "var(--warning)" : "var(--destructive)" }}
                            title={ost === "ok" ? "in band" : ost === "warn" ? "off band" : "critical"}
                          />
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex gap-1.5 mt-1.5">
                    <input
                      className="flex-1 rounded-md px-2 py-1.5 text-sm"
                      style={{ background: "rgba(233,233,237,0.05)", boxShadow: open === r.key ? "inset 0 0 0 1px var(--accent)" : "inset 0 0 0 1px rgba(233,233,237,0.12)", color: "inherit" }}
                      placeholder="custom value"
                      inputMode="decimal"
                      value={draft}
                      onChange={(e) => typeValue(r.key, e.target.value)}
                    />
                    {num !== null && (
                      <button type="button" onClick={() => clear(r.key)} className="rounded-md px-2 text-xs" style={{ border: "1px solid var(--border)", color: "var(--muted-foreground)", cursor: "pointer" }}>
                        clear
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <input
        className="w-full rounded-lg px-3 py-2.5 text-sm"
        style={{ background: "rgba(233,233,237,0.05)", boxShadow: "inset 0 0 0 1px var(--border)", color: "inherit" }}
        placeholder="Note (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="btn-outline rounded-lg px-5 py-2.5 text-sm font-medium"
          style={{ minHeight: 44 }}
        >
          {edit ? "Save changes" : "Save test"}
        </button>
        {saved && <span className="text-sm" style={{ color: "var(--success)" }}>✓ saved</span>}
        {edit && onDone && (
          <button type="button" onClick={onDone} className="btn-outline rounded-lg px-4 py-2.5 text-sm" style={{ minHeight: 44 }}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
