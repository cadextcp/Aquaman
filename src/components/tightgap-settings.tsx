"use client";

/**
 * Global "After catching up" setting (issue #39) — moved from per-schedule
 * (where it was buried) to /more, with an actual explanation of what it does.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveGlobalSettingsAction } from "@/app/actions";
import { StatusNote } from "./ui/status-note";
import { useI18n } from "@/i18n/provider";

export function TightGapSettings({
  initialPolicy,
  initialThreshold,
}: {
  initialPolicy: "fixed" | "suppress";
  initialThreshold: number;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [policy, setPolicy] = useState(initialPolicy);
  const [threshold, setThreshold] = useState(initialThreshold);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  async function save() {
    const res = await saveGlobalSettingsAction({ tightGapPolicy: policy, tightGapThresholdPct: threshold });
    if (res.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      startTransition(() => router.refresh());
    }
  }

  const input = { background: "var(--secondary)", border: "1px solid var(--border)", color: "inherit" };

  return (
    <div className="rounded-xl p-5 edge-card">
      <div className="text-xs uppercase tracking-wide mb-2" style={{ color: "var(--muted-foreground)" }}>
        {t("settings.tightGap.title")}
      </div>
      <p className="text-sm mb-3" style={{ color: "var(--muted-foreground)" }}>
        {t("settings.tightGap.description")}
      </p>
      <div className="space-y-2 mb-4">
        <PolicyOption
          selected={policy === "suppress"}
          onSelect={() => setPolicy("suppress")}
          title={t("settings.tightGap.calmTitle")}
          desc={t("settings.tightGap.calmDesc")}
        />
        <PolicyOption
          selected={policy === "fixed"}
          onSelect={() => setPolicy("fixed")}
          title={t("settings.tightGap.strictTitle")}
          desc={t("settings.tightGap.strictDesc")}
        />
      </div>
      {policy === "suppress" && (
        <label className="flex items-center gap-3 text-sm mb-4" style={{ color: "var(--muted-foreground)" }}>
          {t("settings.tightGap.skipWithin")}
          <input
            type="number"
            min={1}
            max={99}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            className="w-16 rounded px-2 py-1.5"
            style={input}
          />
          {t("settings.tightGap.pctOfInterval")}
        </label>
      )}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="btn-outline rounded-lg px-5 py-2.5 text-sm font-medium"
          style={{ minHeight: 44 }}
        >
          {t("common.save")}
        </button>
        {saved && <StatusNote tone="success">{t("common.saved")}</StatusNote>}
      </div>
      <p className="text-xs mt-3" style={{ color: "var(--muted-foreground)" }}>
        {t("settings.tightGap.footnote")}
      </p>
    </div>
  );
}

function PolicyOption({
  selected,
  onSelect,
  title,
  desc,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  desc: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="w-full text-left rounded-lg p-3"
      style={{
        border: selected ? "1px solid var(--accent)" : "1px solid var(--border)",
        background: selected ? "var(--secondary)" : "transparent",
        cursor: "pointer",
      }}
    >
      <div className="flex items-center gap-2 mb-1">
        <i aria-hidden className={`ph${selected ? "-fill" : ""} ph-${selected ? "radio-button" : "circle"} text-base`} style={{ color: selected ? "var(--accent)" : "var(--faint)" }} />
        <span className="font-medium text-sm">{title}</span>
      </div>
      <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>{desc}</p>
    </button>
  );
}
