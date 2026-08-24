import Link from "next/link";
import { listTanks, listSchedules, feedAllToday } from "@/lib/repo";
import { nextDue, missedSlots, catchUpWeight, MISSED_SLOTS_HINT } from "@/lib/domain/scheduler";
import { today as todayStr, addDays } from "@/lib/domain/dates";
import { ScheduleCard } from "@/components/schedule-card";
import { FeedControl } from "@/components/feed-checkbox";

export const dynamic = "force-dynamic";

export default function Dashboard() {
  const tanks = listTanks();
  const schedules = listSchedules();
  const t = todayStr();
  const weekEnd = addDays(t, 7);
  const feeds = feedAllToday(t);

  // projection for every schedule
  const tasks = schedules
    .map((s) => {
      const due = nextDue(s);
      const missed = missedSlots(s);
      return { s, due, missed, weight: catchUpWeight(s.actionType, due.overdueDays) };
    })
    .filter(({ due }) => due.plannedFor <= weekEnd); // today + this week

  const dueToday = tasks.filter(({ due }) => due.plannedFor <= t);
  const behind = tasks.filter(({ due }) => due.plannedFor > t && due.overdueDays > 0);
  const upcoming = tasks.filter(({ due }) => due.plannedFor > t && due.overdueDays === 0);
  const catchUpCandidate = behind.length > 5 ? behind.sort((a, b) => b.weight - a.weight)[0] : null;

  const kpi = (label: string, value: number | string, color?: string) => (
    <div className="rounded-xl p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      <div className="text-xs uppercase tracking-wide mb-1" style={{ color: "var(--muted-foreground)" }}>{label}</div>
      <div className="text-2xl font-bold" style={{ color }}>{value}</div>
    </div>
  );

  const card = (item: (typeof tasks)[number]) => {
    const { s, due } = item;
    return <ScheduleCard key={s.id} schedule={{ ...s, due, today: t }} />;
  };

  return (
    <main className="flex-1 pb-20 lg:pb-8 p-4 lg:p-8 max-w-3xl">
      {/* Feeding (daily habit) */}
      {tanks.length > 0 && (
        <section className="mb-6">
          <div className="rounded-xl p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <div className="text-xs uppercase tracking-wide mb-3" style={{ color: "var(--muted-foreground)" }}>
              Feeding today
            </div>
            <div className="flex flex-col gap-2">
              {tanks.map((tank) => (
                <FeedControl key={tank.id} tankId={tank.id} tankName={tank.name}
                  timesFed={feeds.find((f) => f.tankId === tank.id)?.timesFed ?? 0} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* KPIs */}
      <section className="grid grid-cols-3 gap-3 mb-6">
        {kpi("Due today", dueToday.length, dueToday.length > 0 ? "var(--accent)" : "var(--success)")}
        {kpi("Behind", behind.length, behind.length > 0 ? "var(--warning)" : undefined)}
        {kpi("This week", upcoming.length)}
      </section>

      {/* Catch-up */}
      {catchUpCandidate && (
        <div className="rounded-xl p-5 mb-6" style={{ background: "var(--secondary)", border: "1px solid var(--warning)" }}>
          <div className="text-xs uppercase tracking-wide mb-2" style={{ color: "var(--muted-foreground)" }}>
            If you only do one thing today
          </div>
          <ScheduleCard schedule={{ ...catchUpCandidate.s, due: catchUpCandidate.due, today: t }} />
          <div className="text-xs mt-1" style={{ color: "var(--muted-foreground)" }}>
            {behind.length - 1} more tasks behind — they keep rescheduling to your preferred days, no rush.
          </div>
        </div>
      )}

      {/* Due today */}
      <section className="mb-6">
        <h2 className="text-lg font-semibold mb-3">Due today</h2>
        {dueToday.length === 0 ? (
          <div className="rounded-xl p-5 text-sm" style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--muted-foreground)" }}>
            Nothing due today — enjoy your tanks! 🐠
          </div>
        ) : (
          <div className="space-y-3">{dueToday.map(card)}</div>
        )}
      </section>

      {/* Behind */}
      {behind.length > 0 && (
        <section className="mb-6">
          <h2 className="text-lg font-semibold mb-3">Behind ({behind.length})</h2>
          <div className="space-y-3">{behind.map(card)}</div>
        </section>
      )}

      {/* Upcoming */}
      {upcoming.length > 0 && (
        <section className="mb-6">
          <h2 className="text-lg font-semibold mb-3">Coming up this week</h2>
          <div className="space-y-3">{upcoming.map(card)}</div>
        </section>
      )}

      {/* Empty state */}
      {tanks.length === 0 && (
        <div className="rounded-xl p-8 text-center" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <p className="mb-4" style={{ color: "var(--muted-foreground)" }}>
            No tanks yet — create your first tank to get started.
          </p>
          <Link href="/tanks/new" className="rounded-lg px-5 py-2.5 text-sm font-medium inline-block"
            style={{ background: "var(--primary)", color: "var(--primary-foreground)", minHeight: 44 }}>
            Create tank
          </Link>
        </div>
      )}
    </main>
  );
}
