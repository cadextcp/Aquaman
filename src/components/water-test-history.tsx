"use client";

/**
 * Water test history with edit/delete (issue #35): every entry is a row with
 * an edit button (re-opens the form pre-filled, in place) and a delete
 * button (confirm → gone). Measurements stay coach context — deleting is for
 * fixing input mistakes.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/i18n/provider";
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
  const { t } = useI18n();
  const [editingId, setEditingId] = useState<number | null>(null);

  async function remove(test: WaterTest) {
    if (!confirm(t("water.deleteConfirm", { date: test.measuredAt.slice(0, 10) }))) return;
    await deleteWaterTest(test.id);
    router.refresh();
  }

  if (tests.length === 0) return null;

  return (
    <div className="rounded-xl p-4 edge-card">
      <div className="text-xs uppercase tracking-wide mb-2" style={{ color: "var(--muted-foreground)" }}>
        {t("water.historyCount", { n: tests.length })}
      </div>
      <ul className="space-y-1.5">
        {tests.slice(0, 10).map((test) =>
          editingId === test.id ? (
            <li key={test.id} className="pt-2">
              <WaterTestForm
                tankId={tankId}
                ranges={ranges}
                edit={{ id: test.id, measuredAt: test.measuredAt, values: test.values, note: test.note }}
                onDone={() => setEditingId(null)}
              />
            </li>
          ) : (
            <li key={test.id} className="flex items-center justify-between gap-2 text-sm">
              <span style={{ color: "var(--muted-foreground)" }} className="min-w-0 truncate">
                {test.measuredAt.slice(0, 10)}:{" "}
                {Object.entries(test.values)
                  .filter(([, v]) => v !== null)
                  .map(([k, v]) => `${k} ${v}`)
                  .join(" · ")}
              </span>
              <span className="flex gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => setEditingId(test.id)}
                  aria-label={t("water.editMeasurement")}
                  title={t("water.editMeasurement")}
                  className="icon-btn icon-btn-sm"
                >
                  <i aria-hidden className="ph ph-pencil-simple text-sm" />
                </button>
                <button
                  type="button"
                  onClick={() => remove(test)}
                  aria-label={t("water.deleteMeasurement")}
                  title={t("water.deleteMeasurement")}
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
