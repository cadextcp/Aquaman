"use client";

/**
 * Nocturne water test form (issue #43, redesign round 4): a 2-column grid
 * of self-contained parameter cards — matches the design's per-parameter
 * card layout exactly (not a row-list): big value, thin band-scale bar with
 * marker, band label + delta footer, tap-to-open dropdown (presets +
 * custom typing + clear).
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { logWaterTest, updateWaterTest } from "@/app/actions";
import { StatusNote } from "./ui/status-note";
import { HelpNote } from "./ui/help";

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
      <HelpNote id="waterRanges" className="mt-0" />
      <div className="h-[3px] rounded-full overflow-hidden" style={{ background: "var(--surface-edge)" }}>
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.round((filled / ranges.length) * 100)}%`, background: "linear-gradient(90deg, var(--due), var(--accent))" }}
        />
      </div>

      {error && <div className="text-sm" style={{ color: "var(--destructive)" }}>{error}</div>}

      <div className="grid grid-cols-2 gap-2">
        {ranges.map((r) => {
          const raw = values[r.key];
          const num = raw !== undefined && raw !== "" ? Number(raw.replace(",", ".")) : null;
          const st = statusOf(r, num);
          const presets = PRESETS[r.key] ?? [];
          const last = lastValues?.[r.key] ?? null;
          const delta = num !== null && last !== null && last !== undefined ? Math.round((num - last) * 100) / 100 : null;
          const isOpen = open === r.key;

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
              className="relative rounded-lg px-2.5 py-2"
              style={{
                background: st === "critical" ? "var(--destructive-soft)" : st === "warn" ? "var(--warning-soft)" : "var(--surface)",
                boxShadow: `inset 0 0 0 1px ${st === "critical" ? "var(--destructive-edge)" : st === "warn" ? "var(--warning-edge)" : "var(--surface-edge)"}`,
              }}
            >
              <div className="flex items-baseline justify-between gap-1">
                <span className="text-[11px] font-medium" style={{ color: "var(--control-foreground)" }}>{r.label}</span>
                <span className="text-[9px]" style={{ color: "var(--faint)" }}>{r.unit}</span>
              </div>

              {/* value display / dropdown toggle */}
              <button
                type="button"
                onClick={() => {
                  setOpen(isOpen ? null : r.key);
                  setDraft("");
                }}
                className="flex items-center justify-between w-full mt-1.5 rounded-md px-2 py-1.5"
                style={{
                  background: "rgba(15,17,28,0.5)",
                  boxShadow: `inset 0 0 0 1px ${isOpen ? "var(--accent)" : "var(--control-edge)"}`,
                  cursor: "pointer",
                  textAlign: "left",
                }}
                aria-label={`Choose ${r.label} value`}
              >
                <span className="text-base font-medium tnum" style={{ color: num === null ? "var(--faint)" : "var(--foreground)" }}>
                  {num === null ? "—" : num}
                </span>
                <i aria-hidden className={`ph ph-caret-${isOpen ? "up" : "down"} text-xs`} style={{ color: "var(--faint)" }} />
              </button>

              {/* band mini-scale */}
              <div className="relative h-1 rounded-full mt-2" style={{ background: "var(--surface-edge)" }} aria-hidden>
                <span
                  className="absolute inset-y-0 rounded-full"
                  style={{ left: `${bandLeft}%`, width: `${bandW}%`, background: "rgba(34,211,238,0.28)" }}
                />
              </div>
              <div className="relative h-1.5 -mt-1.5" aria-hidden>
                {marker !== null && (
                  <span
                    className="absolute top-0 rounded-full"
                    style={{ left: `calc(${marker}% - 3px)`, width: 6, height: 6, background: COL[st], boxShadow: "0 0 0 2px var(--card)" }}
                  />
                )}
              </div>

              {/* footer: band label + delta */}
              <div className="flex items-center justify-between mt-0.5 text-[9px] tnum">
                <span style={{ color: "var(--faint)" }}>
                  {r.min === r.max ? String(r.min) : `${r.min}–${r.max}`}
                </span>
                <span style={{ color: delta === null ? "var(--faint)" : st === "ok" ? "var(--faint)" : COL[st] }}>
                  {delta === null ? (num !== null ? "new" : "not measured") : delta === 0 ? "= 0" : `${delta > 0 ? "+" : "\u2212"}${Math.abs(delta)}`}
                </span>
              </div>

              {/* preset dropdown */}
              {isOpen && (
                <div
                  className="absolute left-0 right-0 top-[34px] z-20 mt-0 rounded-lg p-2 anim-tickin"
                  style={{
                    background: "rgba(26,29,45,0.97)",
                    backdropFilter: "blur(16px)",
                    boxShadow: "0 0 0 1px var(--accent-edge), 0 16px 34px rgba(0,0,0,0.6)",
                  }}
                >
                  <div className="flex items-center gap-1.5 rounded-md px-2 py-1.5" style={{ background: "rgba(15,17,28,0.7)", boxShadow: "inset 0 0 0 1px rgba(233,233,237,0.1)" }}>
                    <i aria-hidden className="ph ph-pencil-simple text-[11px]" style={{ color: "var(--faint)" }} />
                    <input
                      className="flex-1 min-w-0 text-sm tnum bg-transparent border-0 outline-none"
                      style={{ color: "inherit" }}
                      placeholder="type"
                      inputMode="decimal"
                      value={draft}
                      onChange={(e) => typeValue(r.key, e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-0.5 mt-1.5 max-h-28 overflow-y-auto">
                    {presets.map((o) => {
                      const ost = statusOf(r, o);
                      const selected = num === o;
                      return (
                        <button
                          key={o}
                          type="button"
                          onClick={() => pick(r.key, o)}
                          className="flex items-center justify-between gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium tnum"
                          style={{
                            background: selected ? "var(--accent-soft)" : "transparent",
                            color: selected ? "var(--foreground)" : "rgba(233,233,237,0.8)",
                            cursor: "pointer",
                          }}
                        >
                          {o}
                          <span className="flex items-center gap-1">
                            <span style={{ fontSize: 9, color: COL[ost] }}>{ost === "ok" ? "in band" : ost === "warn" ? "off band" : "critical"}</span>
                            <span className="inline-block rounded-full" style={{ width: 4, height: 4, background: COL[ost] }} />
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={() => clear(r.key)}
                    className="w-full mt-1.5 rounded-md px-2 py-1.5 text-[10px]"
                    style={{ background: "transparent", boxShadow: "inset 0 0 0 1px var(--control-edge)", color: "var(--muted-foreground)", cursor: "pointer" }}
                  >
                    not measured
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <input
        className="w-full rounded-lg px-3 py-2.5 text-sm"
        style={{ background: "var(--surface)", boxShadow: "inset 0 0 0 1px var(--border)", color: "inherit" }}
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
        {saved && <StatusNote tone="success">saved</StatusNote>}
        {edit && onDone && (
          <button type="button" onClick={onDone} className="btn-outline rounded-lg px-4 py-2.5 text-sm" style={{ minHeight: 44 }}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
