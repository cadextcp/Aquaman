import { notFound } from "next/navigation";
import Link from "next/link";
import { getTank, listSchedules, recentLogs, waterTestsForTank } from "@/lib/repo";
import { nextDue, missedSlots, MISSED_SLOTS_HINT } from "@/lib/domain/scheduler";
import { evaluateWaterTest, FRESHWATER_RANGES, SALTWATER_RANGES } from "@/lib/domain/ranges";
import { EditTankButton } from "@/components/edit-tank-button";
import { Sparkline } from "@/components/sparkline";
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

  return (
    <main className="flex-1 pb-20 lg:pb-8 p-4 lg:p-8 max-w-3xl">
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
        <div className="rounded-xl p-4 mb-6" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
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
        <div className="rounded-xl p-4 mb-6" style={{ background: "var(--card)", boxShadow: "inset 0 0 0 1px var(--border)" }}>
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
        <details className="rounded-xl p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <summary className="cursor-pointer text-sm" style={{ color: "var(--accent)" }}>+ Add schedule</summary>
          <div className="pt-4">
            <ScheduleForm tankId={tank.id} />
          </div>
        </details>
      </section>

      {/* Water test */}
      <section className="mb-6">
        <h2 className="text-lg font-semibold mb-3">Water tests</h2>
        <details className="rounded-xl p-4 mb-3" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <summary className="cursor-pointer text-sm" style={{ color: "var(--accent)" }}>+ Log water test</summary>
          <div className="pt-4">
            <WaterTestForm tankId={tank.id} ranges={ranges} lastValues={tests[1]?.values} />
          </div>
        </details>
        <WaterTestHistory tankId={tank.id} tests={tests} ranges={ranges} />
      </section>

      {/* Logs */}
      <section className="mb-6">
        <h2 className="text-lg font-semibold mb-3">Recent activity</h2>
        {logs.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>Nothing logged yet.</p>
        ) : (
          <ul className="text-sm space-y-1" style={{ color: "var(--muted-foreground)" }}>
            {logs.map((l) => (
              <li key={l.id}>
                {l.doneAt.slice(0, 10)} — {l.actionType.replace(/_/g, " ")}{l.note ? ` (${l.note})` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>

    </main>
  );
}
