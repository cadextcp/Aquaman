import { notFound } from "next/navigation";
import Link from "next/link";
import { getTank, listSchedules, recentLogs, waterTestsForTank } from "@/lib/repo";
import { nextDue, missedSlots, MISSED_SLOTS_HINT } from "@/lib/domain/scheduler";
import { evaluateWaterTest, FRESHWATER_RANGES, SALTWATER_RANGES } from "@/lib/domain/ranges";
import { EditTankButton } from "@/components/edit-tank-button";
import { Sparkline } from "@/components/sparkline";
import { scheduleAdherence } from "@/lib/stats";
import { STANDARD_PLAN_TYPES } from "@/lib/domain/plan-structure";
import { PlanRecommendBanner } from "@/components/plan-recommend-banner";
import { ScheduleForm } from "@/components/schedule-form";
import { ScheduleCard } from "@/components/schedule-card";
import { today as todayStrLocal } from "@/lib/domain/dates";
import { WaterTestForm } from "@/components/water-test-form";
import { WaterTestHistory } from "@/components/water-test-history";

export const dynamic = "force-dynamic";

export default async function TankDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tank = getTank(Number(id));
  if (!tank) notFound();

  const schedules = listSchedules(tank.id);
  const logs = recentLogs(tank.id, 10);
  const tests = waterTestsForTank(tank.id, 365);
  const ranges = tank.waterType === "salt" ? SALTWATER_RANGES : FRESHWATER_RANGES;
  const lastTest = tests[0];
  const evaluation = lastTest
    ? evaluateWaterTest(lastTest.values, ranges, {
        ph: lastTest.values["ph"] ?? null,
        temp: lastTest.values["temp"] ?? null,
        tankState: tank.tankState,
      })
    : [];
  const problems = evaluation.filter((e) => e.status !== "ok");
  const tankLogs = logs; // recentLogs already fetched
  const adherenceBySchedule = new Map<number, number | null>();
  for (const sch of schedules) {
    adherenceBySchedule.set(
      sch.id,
      scheduleAdherence(
        { id: sch.id, intervalDays: sch.intervalDays, preferredDays: sch.preferredDays, lastDoneAt: sch.lastDoneAt, createdAt: sch.createdAt, active: sch.active },
        tankLogs.filter((l) => l.actionType === sch.actionType),
      ),
    );
  }

  const existingTypes = new Set(schedules.map((x) => x.actionType));
  const missingPlans = STANDARD_PLAN_TYPES.filter((t) => !existingTypes.has(t));

  return (
    <main className="flex-1 pb-20 lg:pb-8 p-4 lg:p-8 max-w-3xl">
      <PlanRecommendBanner tankId={tank.id} tankName={tank.name} missingPlans={missingPlans} hasAnyPlans={schedules.length > 0} />
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">{tank.name}</h1>
          <EditTankButton tank={tank} />
          <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
            {tank.volumeL} L · {tank.waterType === "fresh" ? "Freshwater" : "Saltwater"} ·{" "}
            {tank.tankState === "cycling" ? "cycling" : "established"}
            {tank.hasCo2 ? " · CO₂" : ""}{tank.hasHeater ? " · heater" : ""}
            {tank.hasFilter ? (tank.filterType ? ` · ${tank.filterType}` : " · filter") : ""}
          </p>
        </div>
        <Link href="/tanks" className="text-sm underline" style={{ color: "var(--accent)" }}>← Tanks</Link>
      </div>

      {/* NH₃ alert banner (Nocturne style) */}
      {problems.filter((p) => p.key === "nh3").map((p) => (
        <div key="nh3" className="rounded-lg px-3.5 py-2.5 mb-3 flex items-center gap-2.5" style={{ background: "var(--destructive-soft)", boxShadow: "0 0 0 1px var(--destructive-edge)" }}>
          <i aria-hidden className="ph-fill ph-warning" style={{ color: "var(--destructive)" }} />
          <span className="text-sm tnum" style={{ color: "var(--foreground)" }}>
            {p.message ?? `Free NH₃ ${p.value} mg/l — above 0.020 toxic threshold`}
          </span>
        </div>
      ))}

      {/* Last water test verdict */}
      {lastTest && (
        <div className="rounded-xl p-4 mb-6 edge-card">
          <div className="text-xs uppercase tracking-wide mb-2" style={{ color: "var(--muted-foreground)" }}>
            Last water test · {lastTest.measuredAt.slice(0, 10)}
          </div>
          {problems.length === 0 ? (
            <div style={{ color: "var(--success)" }}>✓ All measured values in range</div>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {problems.map((p) => (
                <li key={p.key}>
                  <span style={{ color: p.status === "critical" ? "var(--destructive)" : "var(--warning)" }}>
                    ● {p.key.toUpperCase()}
                  </span>{" "}
                  {p.value} — {p.status}
                  {p.message ? ` (${p.message})` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Sparklines: last 6 tests per parameter */}
      {tests.length >= 2 && (
        <div className="rounded-xl p-4 mb-6 edge-card">
          <div className="text-xs uppercase tracking-widest mb-3" style={{ color: "var(--muted-foreground)" }}>
            Water · last {Math.min(6, tests.length)} tests
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-5 gap-y-3">
            {Object.keys(tests[0].values).filter((k) => tests.some((t) => typeof t.values[k] === "number")).slice(0, 9).map((key) => {
              const series = tests.slice(0, 6).reverse().map((t) => t.values[key]).filter((v): v is number => typeof v === "number");
              const range = ranges.find((r) => r.key === key);
              const last = series[series.length - 1];
              const st = range && last !== undefined
                ? last < range.min || last > range.max ? "warn" : "ok"
                : "ok";
              return (
                <div key={key} className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-xs uppercase tracking-wide" style={{ color: "var(--muted-foreground)" }}>{range?.label ?? key}</div>
                    <div className="text-sm tnum" style={{ color: st === "warn" ? "var(--warning)" : "var(--foreground)" }}>{last}</div>
                  </div>
                  <Sparkline series={series} color={st === "warn" ? "var(--warning)" : "var(--success)"} />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Schedules */}
      <section className="mb-6">
        <h2 className="text-lg font-semibold mb-3">Care schedule</h2>
        {schedules.length === 0 ? (
          <p className="text-sm mb-3" style={{ color: "var(--muted-foreground)" }}>
            No schedules yet — add your first care routine below.
          </p>
        ) : (
          <div className="space-y-3 mb-4">
            {schedules.map((s) => {
              const due = nextDue(s);
              const missed = missedSlots(s);
              return (
                <div key={s.id}>
                  <ScheduleCard
                    schedule={{ ...s, due, today: todayStrLocal() }}
                    adherence={adherenceBySchedule.get(s.id) ?? null}
                  />
                  {missed >= MISSED_SLOTS_HINT && (
                    <p className="text-xs mt-1 mb-2" style={{ color: "var(--warning)" }}>
                      interval too tight? ({missed} missed slots)
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <details className="rounded-xl p-4 edge-card">
          <summary className="cursor-pointer text-sm" style={{ color: "var(--accent)" }}>+ Add schedule</summary>
          <div className="pt-4">
            <ScheduleForm tankId={tank.id} />
          </div>
        </details>
      </section>

      {/* Water test */}
      <section className="mb-6">
        <h2 className="text-lg font-semibold mb-3">Water tests</h2>
        <details className="rounded-xl p-4 mb-3 edge-card">
          <summary className="cursor-pointer text-sm" style={{ color: "var(--accent)" }}>+ Log water test</summary>
          <div className="pt-4">
            <WaterTestForm tankId={tank.id} ranges={ranges} lastValues={tests[1]?.values} />
          </div>
        </details>
        <WaterTestHistory tankId={tank.id} tests={tests} ranges={ranges} />
      </section>

      {/* Log all activity (design): unified feed of care actions + water tests */}
      <section className="mb-6">
        <h2 className="text-lg font-semibold mb-3">Log all activity</h2>
        {(logs.length === 0 && tests.length === 0) ? (
          <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>Nothing logged yet.</p>
        ) : (
          <div className="space-y-2">
            {[
              ...tests.slice(0, 10).map((tst) => {
                const off = evaluateWaterTest(tst.values, ranges, {
                  ph: tst.values["ph"] ?? null,
                  temp: tst.values["temp"] ?? null,
                  tankState: tank.tankState,
                }).filter((e) => e.status !== "ok").length;
                const filled = Object.values(tst.values).filter((v) => v !== null).length;
                return {
                  key: `t-${tst.id}`,
                  date: tst.measuredAt.slice(0, 10),
                  title: "Water test",
                  note: `${filled} value${filled === 1 ? "" : "s"}${off > 0 ? ` · ${off} outside band` : ""}`,
                  color: off > 0 ? "var(--warning)" : "var(--success)",
                };
              }),
              ...logs.slice(0, 10).map((l) => {
                // lateness annotation: compare against the schedule interval
                const sch = schedules.find((x) => x.actionType === l.actionType);
                let note = l.note ?? "";
                let color = "var(--success)";
                if (sch) {
                  const prev = logs.find((x) => x.actionType === l.actionType && x.doneAt < l.doneAt);
                  if (prev && sch) {
                    const gap = Math.round((new Date(l.doneAt).getTime() - new Date(prev.doneAt).getTime()) / 86400000);
                    const late = gap - sch.intervalDays;
                    if (late > 1) { note = note || `${late} d late`; color = "var(--warning)"; }
                    else if (late < -1) { note = note || "early"; }
                  }
                }
                return {
                  key: `l-${l.id}`,
                  date: l.doneAt.slice(0, 10),
                  title: l.actionType.replace(/_/g, " "),
                  note,
                  color,
                };
              }),
            ]
              .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
              .slice(0, 10)
              .map((row) => (
                <div
                  key={row.key}
                  className="flex items-center justify-between gap-3 rounded-lg px-3.5 py-2.5"
                  style={{ background: "rgba(233,233,237,0.04)", boxShadow: "inset 0 0 0 1px rgba(233,233,237,0.07)" }}
                >
                  <span className="text-sm">
                    <strong className="font-medium">{row.title}</strong>
                    {row.note && (
                      <span className="text-xs" style={{ color: "var(--muted-foreground)" }}> · {row.note}</span>
                    )}
                  </span>
                  <span className="text-xs tnum" style={{ color: "var(--faint)" }}>{row.date}</span>
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: row.color }} />
                </div>
              ))}
          </div>
        )}
      </section>

    </main>
  );
}
