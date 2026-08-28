"use client";

/**
 * Water test history with edit/delete (issue #35): every entry is a row with
 * an edit button (re-opens the form pre-filled, in place) and a delete
 * button (confirm → gone). Measurements stay coach context — deleting is for
 * fixing input mistakes.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteWaterTest } from "@/app/actions";
import { WaterTestForm } from "./water-test-form";
import type { WaterTest } from "@/lib/db/schema";

type RangeLike = { key: string; label: string; unit: string; min: number; max: number; warnMin?: number; warnMax?: number };

export function WaterTestHistory({
  tankId,
  tests,
  ranges,
}: {
  tankId: number;
  tests: WaterTest[];
  ranges: RangeLike[];
}) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<number | null>(null);

  async function remove(t: WaterTest) {
    if (!confirm(`Delete the measurement from ${t.measuredAt.slice(0, 10)}? This cannot be undone.`)) return;
    await deleteWaterTest(t.id);
    router.refresh();
  }

  if (tests.length === 0) return null;

  return (
    <div className="rounded-xl p-4 edge-card">
      <div className="text-xs uppercase tracking-wide mb-2" style={{ color: "var(--muted-foreground)" }}>
        History ({tests.length})
      </div>
      <ul className="space-y-1.5">
        {tests.slice(0, 10).map((t) =>
          editingId === t.id ? (
            <li key={t.id} className="pt-2">
              <WaterTestForm
                tankId={tankId}
                ranges={ranges}
                edit={{ id: t.id, measuredAt: t.measuredAt, values: t.values, note: t.note }}
                onDone={() => setEditingId(null)}
              />
            </li>
          ) : (
            <li key={t.id} className="flex items-center justify-between gap-2 text-sm">
              <span style={{ color: "var(--muted-foreground)" }} className="min-w-0 truncate">
                {t.measuredAt.slice(0, 10)}:{" "}
                {Object.entries(t.values)
                  .filter(([, v]) => v !== null)
                  .map(([k, v]) => `${k} ${v}`)
                  .join(" · ")}
              </span>
              <span className="flex gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => setEditingId(t.id)}
                  aria-label="Edit measurement"
                  title="Edit measurement"
                  className="icon-btn icon-btn-sm"
                >
                  <i aria-hidden className="ph ph-pencil-simple text-sm" />
                </button>
                <button
                  type="button"
                  onClick={() => remove(t)}
                  aria-label="Delete measurement"
                  title="Delete measurement"
                  className="icon-btn icon-btn-sm icon-btn-danger"
                >
                  <i aria-hidden className="ph ph-trash text-sm" />
                </button>
              </span>
            </li>
          ),
        )}
      </ul>
    </div>
  );
}
