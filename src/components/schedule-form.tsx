"use client";

import { useState, useTransition } from "react";
import { HelpNote } from "./ui/help";
import { useRouter } from "next/navigation";
import { createSchedule, markDone, snooze, setScheduleActive } from "@/app/actions";
import { ALL_DAYS, WEEKEND, WEEKDAYS, daysToMask, maskToDays } from "@/lib/schemas";
import type { ScheduleInput } from "@/lib/schemas";
import type { Food, Schedule } from "@/lib/db/schema";
import { StructuredDetailsEditor } from "./structured-details-editor";
import { SCHEDULABLE_ACTION_TYPES, actionTypeDef } from "@/lib/domain/action-types";
import { useI18n } from "@/i18n/provider";

const ACTIONS = SCHEDULABLE_ACTION_TYPES;

/**
 * What the plan editor needs to know about a tank: the label for the move
 * selector, plus the data the structured detail editor computes with. The
 * pages already hand whole tank rows down — the prop types just used to
 * narrow them to {id, name}, which is why every feed plan claimed the tank
 * had no food types and every water change was measured against 60 L.
 */
export type ScheduleFormTank = { id: number; name: string; volumeL: number; foods: Food[] };

/** Only reachable if a caller passes a list without the tank it names — the percentage still needs SOME denominator. */
const FALLBACK_VOLUME_L = 60;

export function ScheduleForm({
  tankId,
  tanks,
  schedule,
  globalPolicy = "suppress",
  globalThreshold = 50,
}: {
  tankId: number;
  /**
   * The tanks this form may point at — the move selector's options AND where
   * volume/foods come from. REQUIRED (and must contain `tankId`): it used to
   * be optional next to `tankVolumeL`/`tankFoods` props that defaulted to
   * 60 L and no foods, so a call site that forgot them compiled fine and
   * silently mis-computed every water change. Now there is nothing to forget.
   */
  tanks: ScheduleFormTank[];
  schedule?: Schedule & { tankName: string };
  /** global default from /more (issue #39) — "default" means "like global" */
  globalPolicy?: "fixed" | "suppress";
  globalThreshold?: number;
}) {
  const router = useRouter();
  const { t, weekdayLabels, errorText } = useI18n();
  const editing = !!schedule;
  const [selectedTankId, setSelectedTankId] = useState(tankId);
  const [actionType, setActionType] = useState(schedule?.actionType ?? "water_change");
  const [intervalDays, setIntervalDays] = useState(schedule?.intervalDays ?? 7);
  const [days, setDays] = useState<number[]>(schedule ? maskToDays(schedule.preferredDays) : [0, 1, 2, 3, 4, 5, 6]);
  const [autoReschedule, setAutoReschedule] = useState(schedule?.autoReschedule ?? true);
  const [policy, setPolicy] = useState<"default" | "fixed" | "suppress">(
    schedule?.tightGapPolicy ?? "default",
  );
  const [threshold, setThreshold] = useState(schedule?.tightGapThresholdPct ?? globalThreshold);
  const [details, setDetails] = useState(schedule?.details ?? "");
  const [detailData, setDetailData] = useState<Record<string, unknown> | null>(
    (schedule?.detailData as Record<string, unknown> | null) ?? null,
  );
  const [endsOn, setEndsOn] = useState(schedule?.endsOn ?? "");
  /**
   * Volume and foods come from the tank the form is CURRENTLY pointed at, not
   * from the one it opened on: moving a plan to another aquarium has to move
   * the percentage→liters maths and the food list with it.
   */
  const selectedTank = tanks.find((tk) => tk.id === selectedTankId);
  const volumeL = selectedTank?.volumeL ?? FALLBACK_VOLUME_L;
  const foods = selectedTank?.foods ?? [];
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggleDay(d: number) {
    setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort((a, b) => a - b)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const input: ScheduleInput = {
      tankId: selectedTankId,
      actionType,
      intervalDays,
      preferredDays: daysToMask(days),
      autoReschedule,
      tightGapPolicy: policy === "default" ? null : policy,
      tightGapThresholdPct: policy === "suppress" ? threshold : null,
      details: details.trim() === "" ? null : details.trim(),
      detailData,
      endsOn: endsOn === "" ? null : endsOn,
    };
    const res = editing
      ? await (await import("@/app/actions")).updateSchedule(schedule.id, input)
      : await createSchedule(input);
    if (!res.ok) {
      setError(errorText(res));
      return;
    }
    startTransition(() => router.refresh());
  }

  const input = { background: "var(--secondary)", border: "1px solid var(--border)", color: "inherit" };
  const field = "w-full rounded-lg px-3 py-2.5 text-sm";

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <div className="text-sm" style={{ color: "var(--destructive)" }}>{error}</div>}

      {editing && tanks.length > 0 && (
        <div>
          <label className="block text-xs uppercase tracking-wide mb-1">{t("schedule.tank")}</label>
          <select className={field} style={input} value={selectedTankId}
            onChange={(e) => setSelectedTankId(Number(e.target.value))}>
            {tanks.map((tk) => <option key={tk.id} value={tk.id}>{tk.name}</option>)}
          </select>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-xs uppercase tracking-wide mb-1">{t("schedule.action")}</label>
          <input list="action-list" className={field} style={input} value={actionType}
            onChange={(e) => setActionType(e.target.value)} required />
          <datalist id="action-list">{ACTIONS.map((a) => <option key={a} value={a} />)}</datalist>
        </div>
        <div>
          <label className="block text-xs uppercase tracking-wide mb-1">{t("schedule.interval")}</label>
          <input type="number" min={1} max={365} className={field} style={input} value={intervalDays}
            onChange={(e) => setIntervalDays(Number(e.target.value))} required />
        </div>
      </div>

      {actionTypeDef(actionType)?.detailKind ? (
        <StructuredDetailsEditor
          actionType={actionType}
          tankVolumeL={volumeL}
          tankFoods={foods}
          value={detailData}
          onChange={(data, rendered) => {
            setDetailData(data);
            setDetails(rendered); // keep the human-readable line in sync
          }}
        />
      ) : (
        <div>
          <label className="block text-xs uppercase tracking-wide mb-1">{t("schedule.details")}</label>
          <input className={field} style={input} value={details}
            placeholder={t("schedule.detailsPlaceholder")}
            onChange={(e) => setDetails(e.target.value)} maxLength={300} />
        </div>
      )}
      {details && (
        <p className="text-xs" style={{ color: "var(--accent-light)" }}>→ {details}</p>
      )}

      <div>
        <label className="block text-xs uppercase tracking-wide mb-1">{t("schedule.endsOn")}</label>
        <input type="date" className={field} style={input} value={endsOn}
          onChange={(e) => setEndsOn(e.target.value)} />
        <HelpNote id="endsOn" />
      </div>

      <div>
        <label className="block text-xs uppercase tracking-wide mb-1.5">{t("schedule.preferred")}</label>
        <div className="flex flex-wrap gap-1.5">
          {weekdayLabels().map((d, i) => (
            <button key={d} type="button" onClick={() => toggleDay(i)}
              className="rounded-lg px-3 py-2 text-xs font-medium"
              style={{
                minHeight: 44,
                background: days.includes(i) ? "var(--accent-soft)" : "var(--secondary)",
                boxShadow: days.includes(i) ? "inset 0 0 0 1px var(--accent)" : "none",
                color: days.includes(i) ? "var(--accent-light)" : "var(--secondary-foreground)",
              }}>
              {d}
            </button>
          ))}
        </div>
        <div className="flex gap-3 mt-2 text-xs">
          <button type="button" className="underline" style={{ color: "var(--accent)" }} onClick={() => setDays(maskToDays(ALL_DAYS))}>{t("schedule.everyDay")}</button>
          <button type="button" className="underline" style={{ color: "var(--accent)" }} onClick={() => setDays(maskToDays(WEEKEND))}>{t("schedule.weekends")}</button>
          <button type="button" className="underline" style={{ color: "var(--accent)" }} onClick={() => setDays(maskToDays(WEEKDAYS))}>{t("schedule.weekdays")}</button>
        </div>
        <HelpNote id="preferredDays" />
      </div>

      <label className="flex items-center gap-3 text-sm py-1">
        <input type="checkbox" checked={autoReschedule} onChange={(e) => setAutoReschedule(e.target.checked)}
          className="h-5 w-5" style={{ accentColor: "var(--primary)" }} />
        {t("schedule.autoResched")}
      </label>

      <fieldset className="rounded-lg p-3" style={{ border: "1px solid var(--border)" }}>
        <legend className="text-xs uppercase tracking-wide px-2">{t("schedule.afterCatchup")}</legend>
        <div className="flex flex-wrap gap-2 mb-2">
          {([
            ["default", t("schedule.likeGlobal", { mode: globalPolicy === "suppress" ? t("schedule.modeCalm") : t("schedule.modeStrict") })],
            ["suppress", t("schedule.policySuppress")],
            ["fixed", t("schedule.policyFixed")],
          ] as const).map(([v, labelText]) => (
            <button key={v} type="button" onClick={() => setPolicy(v)}
              className="rounded-lg px-3 py-2 text-xs"
              style={{
                background: policy === v ? "var(--accent-soft)" : "var(--secondary)",
                boxShadow: policy === v ? "inset 0 0 0 1px var(--accent)" : "none",
                color: policy === v ? "var(--accent-light)" : "var(--secondary-foreground)",
              }}>
              {labelText}
            </button>
          ))}
        </div>
        {policy === "suppress" && (
          <label className="flex items-center gap-3 text-xs" style={{ color: "var(--muted-foreground)" }}>
            {t("schedule.skipWithin")}
            <input type="number" min={1} max={99} value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))} className="w-16 rounded px-2 py-1"
              style={input} />
            {t("schedule.pctOfInterval")}
          </label>
        )}
      </fieldset>

      <div className="flex gap-3">
        <button type="submit" disabled={pending}
          className="btn-outline rounded-lg px-5 py-2.5 text-sm font-medium"
          style={{ minHeight: 44 }}>
          {editing ? t("common.save") : t("schedule.addSubmit")}
        </button>
        {editing && (
          <button type="button" disabled={pending}
            onClick={async () => { await setScheduleActive(schedule.id, !schedule.active); startTransition(() => router.refresh()); }}
            className="rounded-lg px-5 py-2.5 text-sm" style={{ border: "1px solid var(--border)", minHeight: 44 }}>
            {schedule.active ? t("schedule.pause") : t("schedule.resume")}
          </button>
        )}
      </div>
    </form>
  );
}

/** Compact done/snooze buttons (dashboard cards + tank detail). */
export function TaskActions({ scheduleId, compact = false }: { scheduleId: number; compact?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [snoozeOpen, setSnoozeOpen] = useState(false);

  async function done() {
    await markDone(scheduleId);
    startTransition(() => router.refresh());
  }
  async function snoozeBy(days: number) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    await snooze(scheduleId, d.toISOString().slice(0, 10));
    setSnoozeOpen(false);
    startTransition(() => router.refresh());
  }

  const btn = "rounded-lg text-sm font-medium";
  const pad = compact ? "px-3 py-1.5" : "px-4 py-2.5";

  return (
    <div className="flex items-center gap-1.5">
      <button onClick={done} disabled={pending} className={`btn-outline ${btn} ${pad}`}
        style={{ minHeight: 36 }}>
        <i aria-hidden className="ph ph-check" /> Done
      </button>
      <div className="relative">
        <button onClick={() => setSnoozeOpen((o) => !o)} disabled={pending} className={`${btn} ${pad}`}
          style={{ border: "1px solid var(--border)", minHeight: 36 }}>
          <i aria-hidden className="ph ph-clock" /> Later
        </button>
        {snoozeOpen && (
          <div className="absolute right-0 top-full mt-1 rounded-lg z-10 py-1 shadow-lg"
            style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            {[1, 3, 7].map((d) => (
              <button key={d} onClick={() => snoozeBy(d)}
                className="block w-full text-left px-4 py-2 text-sm hover:opacity-80">
                +{d} {d === 1 ? "day" : "days"}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
