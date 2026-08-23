import { notFound } from "next/navigation";
import Link from "next/link";
import { getTank, listSchedules, recentLogs, waterTestsForTank } from "@/lib/repo";
import { nextDue, missedSlots, MISSED_SLOTS_HINT } from "@/lib/domain/scheduler";
import { evaluateWaterTest, FRESHWATER_RANGES, SALTWATER_RANGES } from "@/lib/domain/ranges";
import { TankForm } from "@/components/tank-form";
import { ScheduleForm } from "@/components/schedule-form";
import { TaskActions } from "@/components/schedule-form";
import { WaterTestForm } from "@/components/water-test-form";

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
        <div>
          <h1 className="text-2xl font-bold">{tank.name}</h1>
          <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
            {tank.volumeL} L · {tank.waterType === "fresh" ? "Freshwater" : "Saltwater"} ·{" "}
            {tank.tankState === "cycling" ? "cycling" : "established"}
            {tank.hasCo2 ? " · CO₂" : ""}{tank.hasHeater ? " · heater" : ""}
            {tank.hasFilter ? (tank.filterType ? ` · ${tank.filterType}` : " · filter") : ""}
          </p>
        </div>
        <Link href="/tanks" className="text-sm underline" style={{ color: "var(--accent)" }}>← Tanks</Link>
      </div>

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
                <div key={s.id} className="rounded-xl p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div>
                      <span className="font-medium">{s.actionType.replace(/_/g, " ")}</span>
                      <span className="text-sm" style={{ color: "var(--muted-foreground)" }}>
                        {" "}· every {s.intervalDays}d
                      </span>
                    </div>
                    <TaskActions scheduleId={s.id} compact />
                  </div>
                  <div className="text-sm" style={{ color: "var(--muted-foreground)" }}>
                    {due.overdueDays > 0 ? (
                      <>
                        <span style={{ color: "var(--warning)" }}>behind {due.overdueDays}d</span>
                        {" · planned "}
                      </>
                    ) : ("planned ")}
                    <strong>{due.plannedFor}</strong>
                    {missed >= MISSED_SLOTS_HINT && (
                      <span style={{ color: "var(--warning)" }}> · interval too tight? ({missed} missed)</span>
                    )}
                  </div>
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
            <WaterTestForm tankId={tank.id} ranges={ranges.map((r) => ({ key: r.key, label: r.label, unit: r.unit }))} />
          </div>
        </details>
        {tests.length > 0 && (
          <div className="rounded-xl p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <div className="text-xs uppercase tracking-wide mb-2" style={{ color: "var(--muted-foreground)" }}>
              History ({tests.length})
            </div>
            <ul className="text-sm space-y-1" style={{ color: "var(--muted-foreground)" }}>
              {tests.slice(0, 5).map((t) => {
                const vals = Object.entries(t.values).filter(([, v]) => v !== null);
                return (
                  <li key={t.id}>
                    {t.measuredAt.slice(0, 10)}: {vals.map(([k, v]) => `${k} ${v}`).join(" · ")}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
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

      {/* Edit */}
      <details className="rounded-xl p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <summary className="cursor-pointer text-sm" style={{ color: "var(--accent)" }}>Edit tank</summary>
        <div className="pt-4">
          <TankForm tank={tank} />
        </div>
      </details>
    </main>
  );
}
