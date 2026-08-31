"use client";

import { useState, useTransition } from "react";
import { HelpNote } from "./ui/help";
import { useRouter } from "next/navigation";
import { createSchedule, markDone, snooze, setScheduleActive } from "@/app/actions";
import { WEEKDAY_LABELS, ALL_DAYS, WEEKEND, WEEKDAYS, daysToMask, maskToDays } from "@/lib/schemas";
import type { ScheduleInput } from "@/lib/schemas";
import type { Schedule } from "@/lib/db/schema";
import { StructuredDetailsEditor } from "./structured-details-editor";
import { formatDetailData } from "@/lib/domain/plan-structure";
import { SCHEDULABLE_ACTION_TYPES, actionTypeDef } from "@/lib/domain/action-types";

const ACTIONS = SCHEDULABLE_ACTION_TYPES;

export function ScheduleForm({
  tankId,
  schedule,
  globalPolicy = "suppress",
  globalThreshold = 50,
  tankVolumeL = 60,
  tankFoods = [],
}: {
  tankId: number;
  schedule?: Schedule & { tankName: string };
  /** global default from /more (issue #39) — "default" means "like global" */
  globalPolicy?: "fixed" | "suppress";
  globalThreshold?: number;
  /** issue #42: for structured detail rendering (% → liters, feed foods) */
  tankVolumeL?: number;
  tankFoods?: { name: string; amount: string; unit: string }[];
}) {
  const router = useRouter();
  const editing = !!schedule;
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
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggleDay(d: number) {
    setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort((a, b) => a - b)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const input: ScheduleInput = {
      tankId,
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
      setError(res.error);
      return;
    }
    startTransition(() => router.refresh());
  }

  const input = { background: "var(--secondary)", border: "1px solid var(--border)", color: "inherit" };
  const field = "w-full rounded-lg px-3 py-2.5 text-sm";

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <div className="text-sm" style={{ color: "var(--destructive)" }}>{error}</div>}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-xs uppercase tracking-wide mb-1">Action</label>
          <input list="action-list" className={field} style={input} value={actionType}
            onChange={(e) => setActionType(e.target.value)} required />
          <datalist id="action-list">{ACTIONS.map((a) => <option key={a} value={a} />)}</datalist>
        </div>
        <div>
          <label className="block text-xs uppercase tracking-wide mb-1">Every … days</label>
          <input type="number" min={1} max={365} className={field} style={input} value={intervalDays}
            onChange={(e) => setIntervalDays(Number(e.target.value))} required />
        </div>
      </div>

      {actionTypeDef(actionType)?.detailKind ? (
        <StructuredDetailsEditor
          actionType={actionType}
          tankVolumeL={tankVolumeL}
          tankFoods={tankFoods}
          value={detailData}
          onChange={(data, rendered) => {
            setDetailData(data);
            setDetails(rendered); // keep the human-readable line in sync
          }}
        />
      ) : (
        <div>
          <label className="block text-xs uppercase tracking-wide mb-1">Details (optional)</label>
          <input className={field} style={input} value={details}
            placeholder='e.g. "rinse media in tank water"'
            onChange={(e) => setDetails(e.target.value)} maxLength={300} />
        </div>
      )}
      {details && (
        <p className="text-xs" style={{ color: "var(--accent-light)" }}>→ {details}</p>
      )}

      <div>
        <label className="block text-xs uppercase tracking-wide mb-1">Ends on (optional)</label>
        <input type="date" className={field} style={input} value={endsOn}
          onChange={(e) => setEndsOn(e.target.value)} />
        <HelpNote id="endsOn" />
      </div>

      <div>
        <label className="block text-xs uppercase tracking-wide mb-1.5">Preferred days</label>
        <div className="flex flex-wrap gap-1.5">
          {WEEKDAY_LABELS.map((d, i) => (
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
          <button type="button" className="underline" style={{ color: "var(--accent)" }} onClick={() => setDays(maskToDays(ALL_DAYS))}>every day</button>
          <button type="button" className="underline" style={{ color: "var(--accent)" }} onClick={() => setDays(maskToDays(WEEKEND))}>weekends</button>
          <button type="button" className="underline" style={{ color: "var(--accent)" }} onClick={() => setDays(maskToDays(WEEKDAYS))}>weekdays</button>
        </div>
        <HelpNote id="preferredDays" />
      </div>

      <label className="flex items-center gap-3 text-sm py-1">
        <input type="checkbox" checked={autoReschedule} onChange={(e) => setAutoReschedule(e.target.checked)}
          className="h-5 w-5" style={{ accentColor: "var(--primary)" }} />
        Auto-reschedule overdue tasks to the next preferred day
      </label>

      <fieldset className="rounded-lg p-3" style={{ border: "1px solid var(--border)" }}>
        <legend className="text-xs uppercase tracking-wide px-2">After catching up</legend>
        <div className="flex flex-wrap gap-2 mb-2">
          {([
            ["default", `Like global (${globalPolicy === "suppress" ? "calm" : "strict"})`],
            ["suppress", "Calm — skip too-soon repeats"],
            ["fixed", "Strict — keep exact grid"],
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
            Skip if next date is within
            <input type="number" min={1} max={99} value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))} className="w-16 rounded px-2 py-1"
              style={input} />
            % of the interval
          </label>
        )}
      </fieldset>

      <div className="flex gap-3">
        <button type="submit" disabled={pending}
          className="btn-outline rounded-lg px-5 py-2.5 text-sm font-medium"
          style={{ minHeight: 44 }}>
          {editing ? "Save" : "Add schedule"}
        </button>
        {editing && (
          <button type="button" disabled={pending}
            onClick={async () => { await setScheduleActive(schedule.id, !schedule.active); startTransition(() => router.refresh()); }}
            className="rounded-lg px-5 py-2.5 text-sm" style={{ border: "1px solid var(--border)", minHeight: 44 }}>
            {schedule.active ? "Pause" : "Resume"}
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
