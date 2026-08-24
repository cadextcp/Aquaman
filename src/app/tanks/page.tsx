import Link from "next/link";
import { listTanks, listSchedules, waterTestsForTank } from "@/lib/repo";
import { nextDue } from "@/lib/domain/scheduler";
import { evaluateWaterTest, FRESHWATER_RANGES, SALTWATER_RANGES } from "@/lib/domain/ranges";
import { today as todayStr, addDays } from "@/lib/domain/dates";
import { scheduleAdherence, crossTankStats, cyclingInfo, dailyActivity } from "@/lib/stats";
import { db } from "@/lib/db";
import { maintenanceLogs } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export default async function TanksPage() {
  const tanks = listTanks();
  const t = todayStr();
  const weekEnd = addDays(t, 7);
  const allSchedules = listSchedules();
  const allLogs = db.select().from(maintenanceLogs).all();
  const cross = crossTankStats();
  const activity = dailyActivity(30);
  const maxCount = Math.max(1, ...activity.map((a) => a.count));

  return (
    <main className="flex-1 pb-20 lg:pb-8 p-4 lg:p-8 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Tanks</h1>
        <Link href="/tanks/new" className="btn-outline rounded-lg px-4 py-2.5 text-sm font-medium"
          style={{ minHeight: 44 }}>
          + New tank
        </Link>
      </div>

      {tanks.length === 0 ? (
        <div className="rounded-xl p-8 text-center edge-card">
          <p className="mb-4" style={{ color: "var(--muted-foreground)" }}>No tanks yet — create your first tank.</p>
          <Link href="/tanks/new" className="underline" style={{ color: "var(--accent)" }}>
            Create tank →
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {tanks.map((tank) => {
            const schedules = allSchedules.filter((s) => s.tankId === tank.id);
            const dues = schedules
              .map((s) => ({ s, due: nextDue(s) }))
              .filter(({ due, s }) => (s.endsOn && s.endsOn < t ? false : due.plannedFor <= weekEnd));
            const dueToday = dues.filter(({ due }) => due.plannedFor <= t);
            const overdue = dues.filter(({ due }) => due.overdueDays > 0);
            const nextUp = dues
              .filter(({ due }) => due.plannedFor > t)
              .sort((a, b) => (a.due.plannedFor < b.due.plannedFor ? -1 : 1))[0];

            const tests = waterTestsForTank(tank.id, 365);
            const lastTest = tests[0];
            const ranges = tank.waterType === "salt" ? SALTWATER_RANGES : FRESHWATER_RANGES;
            const problems = lastTest
              ? evaluateWaterTest(lastTest.values, ranges, {
                  ph: lastTest.values["ph"] ?? null,
                  temp: lastTest.values["temp"] ?? null,
                  tankState: tank.tankState,
                }).filter((e) => e.status !== "ok")
              : [];

            const fishSummary = tank.fish.map((f) => `${f.species} ×${f.qty}`).join(", ");
            const plantSummary = tank.plants.map((p) => p.name).join(", ");

            const adherences = schedules
              .map((sch) =>
                scheduleAdherence(
                  { id: sch.id, intervalDays: sch.intervalDays, preferredDays: sch.preferredDays, lastDoneAt: sch.lastDoneAt, createdAt: sch.createdAt, active: sch.active },
                  allLogs.filter((l) => l.tankId === tank.id && l.actionType === sch.actionType),
                ),
              )
              .filter((a): a is number => a !== null);
            const onTime =
              adherences.length > 0 ? Math.round(adherences.reduce((a, b) => a + b, 0) / adherences.length) : null;
            const cycling = cyclingInfo(tank);

            return (
              <Link key={tank.id} href={`/tanks/${tank.id}`}
                className="rounded-xl p-5 block edge-card">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <div className="text-lg font-semibold">{tank.name}</div>
                    <div className="text-sm" style={{ color: "var(--muted-foreground)" }}>
                      {tank.volumeL} L · {tank.waterType === "fresh" ? "Freshwater" : "Saltwater"} ·{" "}
                      {tank.tankState === "cycling" ? "cycling" : "established"}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    {cycling && (
                      <Badge>
                        <span className="tnum">cycling day {cycling.day}</span>
                        {cycling.no2trend === "falling" && <span style={{ color: "var(--success)" }}> · NO₂ ▼</span>}
                        {cycling.no2trend === "rising" && <span style={{ color: "var(--warning)" }}> · NO₂ ▲</span>}
                      </Badge>
                    )}
                    {tank.hasCo2 && <Badge>CO₂</Badge>}
                    {tank.hasHeater && <Badge>heat</Badge>}
                    {tank.filterType && <Badge>{tank.filterType}</Badge>}
                  </div>
                </div>

                {(fishSummary || plantSummary) && (
                  <div className="text-sm mb-3" style={{ color: "var(--muted-foreground)" }}>
                    {fishSummary && <div>🐟 {fishSummary}</div>}
                    {plantSummary && <div>🌿 {plantSummary}</div>}
                  </div>
                )}

                <div className="grid grid-cols-3 gap-2 mb-3">
                  <Stat label="due today" value={dueToday.length} accent={dueToday.length > 0} />
                  <Stat label="behind" value={overdue.length} warn={overdue.length > 0} />
                  <Stat label="plans" value={schedules.length} />
                </div>

                <div className="flex items-center justify-between gap-2 text-xs" style={{ color: "var(--muted-foreground)" }}>
                  <span>
                    {nextUp
                      ? `next: ${nextUp.s.actionType.replace(/_/g, " ")} ${nextUp.due.plannedFor}`
                      : schedules.length === 0
                        ? "no plans yet"
                        : "nothing this week"}
                    {onTime !== null && (
                      <span className="tnum" style={{ color: onTime >= 80 ? "var(--success)" : "var(--warning)" }}>
                        {" "}· {onTime}% on time
                      </span>
                    )}
                  </span>
                  {lastTest ? (
                    <span style={{ color: problems.length > 0 ? "var(--warning)" : "var(--success)" }}>
                      ● {problems.length > 0 ? `${problems.length} value${problems.length > 1 ? "s" : ""} off` : "values ok"} ({lastTest.measuredAt.slice(0, 10)})
                    </span>
                  ) : (
                    <span>no water test yet</span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* Across both tanks (design): 30-bar daily activity chart */}
      {tanks.length > 0 && (
        <div className="mt-4 rounded-xl p-4 edge-card">
          <span className="text-xs uppercase tracking-widest" style={{ color: "var(--muted-foreground)" }}>
            Across {tanks.length === 1 ? "tank" : "all tanks"} · 30 d
          </span>
          <div className="flex items-end gap-1 mt-3" style={{ height: 44 }}>
            {activity.map((a, i) => (
              <span
                key={a.date}
                className="flex-1 rounded-sm"
                style={{
                  height: `${Math.max(6, Math.round((a.count / maxCount) * 100))}%`,
                  background: i >= activity.length - 4 ? "var(--accent)" : "rgba(34,211,238,0.45)",
                }}
                title={`${a.date}: ${a.count}`}
              />
            ))}
          </div>
          <div className="flex items-center justify-between mt-2 text-[9px] tnum" style={{ color: "rgba(233,233,237,0.35)" }}>
            <span>{activity[0]?.date.slice(5)}</span>
            <span>{cross.actions} care actions</span>
            <span>{activity[activity.length - 1]?.date.slice(5)}</span>
          </div>
        </div>
      )}
    </main>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full px-2 py-0.5 text-xs whitespace-nowrap"
      style={{ background: "var(--secondary)", color: "var(--secondary-foreground)" }}>
      {children}
    </span>
  );
}

function Stat({ label, value, accent, warn }: { label: string; value: number; accent?: boolean; warn?: boolean }) {
  return (
    <div className="rounded-lg p-2 text-center" style={{ background: "var(--secondary)" }}>
      <div className="text-lg font-medium tnum" style={{ color: warn ? "var(--warning)" : accent ? "var(--due)" : undefined }}>
        {value}
      </div>
      <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>{label}</div>
    </div>
  );
}
