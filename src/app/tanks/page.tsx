import Link from "next/link";
import { listTanks, listSchedules, waterTestsForTank } from "@/lib/repo";
import { nextDue } from "@/lib/domain/scheduler";
import { evaluateWaterTest, FRESHWATER_RANGES, SALTWATER_RANGES } from "@/lib/domain/ranges";
import { today as todayStr, addDays } from "@/lib/domain/dates";

export const dynamic = "force-dynamic";

export default async function TanksPage() {
  const tanks = listTanks();
  const t = todayStr();
  const weekEnd = addDays(t, 7);
  const allSchedules = listSchedules();

  return (
    <main className="flex-1 pb-20 lg:pb-8 p-4 lg:p-8 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Tanks</h1>
        <Link href="/tanks/new" className="rounded-lg px-4 py-2.5 text-sm font-medium"
          style={{ background: "var(--primary)", color: "var(--primary-foreground)", minHeight: 44 }}>
          + New tank
        </Link>
      </div>

      {tanks.length === 0 ? (
        <div className="rounded-xl p-8 text-center" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
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

            return (
              <Link key={tank.id} href={`/tanks/${tank.id}`}
                className="rounded-xl p-5 block transition-shadow hover:shadow-md"
                style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <div className="text-lg font-semibold">{tank.name}</div>
                    <div className="text-sm" style={{ color: "var(--muted-foreground)" }}>
                      {tank.volumeL} L · {tank.waterType === "fresh" ? "Freshwater" : "Saltwater"} ·{" "}
                      {tank.tankState === "cycling" ? "cycling" : "established"}
                    </div>
                  </div>
                  <div className="flex gap-1">
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
      <div className="text-lg font-bold" style={{ color: warn ? "var(--warning)" : accent ? "var(--accent)" : undefined }}>
        {value}
      </div>
      <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>{label}</div>
    </div>
  );
}
