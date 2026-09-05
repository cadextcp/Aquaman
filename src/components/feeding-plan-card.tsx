"use client";

/**
 * The tank's free-form feeding plan (docs/plan-fuetterungsplan.md).
 *
 * Markdown in, markdown out: a textarea to edit, react-markdown to view (no
 * rehype-raw — AI-proposed and hand-typed content alike arrive as ESCAPED
 * text, never as HTML). Saving goes through the setTankFeedingPlan Server
 * Action; this component never touches the DB and never renders for deleted
 * tanks (the page below it already did that check).
 */

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { useI18n } from "@/i18n/provider";
import { StatusNote } from "@/components/ui/status-note";
import { setTankFeedingPlan } from "@/app/actions";
import { FEEDING_PLAN_MAX_CHARS } from "@/lib/schemas";

export function FeedingPlanCard({ tankId, initialPlan }: { tankId: number; initialPlan: string | null }) {
  const { t, errorText } = useI18n();
  const [plan, setPlan] = useState(initialPlan ?? "");
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await setTankFeedingPlan(tankId, plan);
      if (!res.ok) {
        setError(errorText(res));
        return;
      }
      setEditing(false);
    } catch {
      setError(errorText({ error: "save failed", code: "tank.updateFailed" }));
    } finally {
      setPending(false);
    }
  }

  const inputStyle = { background: "var(--surface)", boxShadow: "inset 0 0 0 1px var(--border)", color: "inherit" };

  return (
    <div className="rounded-xl p-5 edge-card">
      {editing ? (
        <div className="flex flex-col gap-2">
          <textarea
            className="rounded-lg px-3 py-2.5 text-sm"
            style={{ ...inputStyle, minHeight: 220, resize: "vertical", fontFamily: "var(--font-mono, monospace)" }}
            value={plan}
            maxLength={FEEDING_PLAN_MAX_CHARS}
            placeholder={t("tankDetail.feedingPlaceholder")}
            disabled={pending}
            onChange={(e) => setPlan(e.target.value)}
            // The editor is a block on the page, not a modal — nothing to
            // submit underneath it, but Enter must not bubble into anything.
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void save();
              }
            }}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-outline rounded-lg px-4 py-2 text-sm font-medium"
              style={{ minHeight: 44 }}
              disabled={pending}
              onClick={() => void save()}
            >
              {pending ? t("tankDetail.feedingSaving") : t("tankDetail.feedingSave")}
            </button>
            <button
              type="button"
              className="btn-ghost rounded-lg px-4 py-2 text-sm"
              style={{ minHeight: 44 }}
              disabled={pending}
              onClick={() => {
                setPlan(initialPlan ?? "");
                setEditing(false);
                setError(null);
              }}
            >
              {t("tankDetail.feedingCancel")}
            </button>
            <span className="text-xs ml-auto tnum" style={{ color: "var(--faint)" }}>
              {plan.length}/{FEEDING_PLAN_MAX_CHARS}
            </span>
          </div>
        </div>
      ) : plan.trim() === "" ? (
        <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
          {t("tankDetail.feedingEmpty")}
        </p>
      ) : (
        <div className="markdown text-sm">
          <ReactMarkdown>{plan}</ReactMarkdown>
        </div>
      )}

      {error && (
        <div className="mt-2">
          <StatusNote tone="error">{error}</StatusNote>
        </div>
      )}

      {!editing && (
        <button
          type="button"
          className="btn-ghost rounded-lg px-3 py-1.5 text-xs mt-2"
          onClick={() => setEditing(true)}
        >
          {t("tankDetail.feedingEdit")}
        </button>
      )}
    </div>
  );
}
