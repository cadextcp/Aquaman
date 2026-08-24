import Link from "next/link";
import { listSchedules } from "@/lib/repo";
import { occurrencesInRange } from "@/lib/domain/scheduler";
import { CalendarChip } from "@/components/calendar-chip";
import { today as todayStr, monthGridRange, shiftMonth } from "@/lib/domain/dates";

export const dynamic = "force-dynamic";

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function monthLabel(monthStr: string): string {
  const [y, m] = monthStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const { m } = await searchParams;
  const t = todayStr();
  const month = m && /^\d{4}-\d{2}$/.test(m) ? m : t.slice(0, 7);

  const schedules = listSchedules();
  const { from, to, days } = monthGridRange(month);

  // date (YYYY-MM-DD) → list of tasks (with schedule ref → clickable, issue #31)
  type DayTask = { label: string; overdue: boolean; variant: "behind" | "due" | "upcoming"; schedule: (typeof schedules)[number] };
  const byDate = new Map<string, DayTask[]>();
  for (const s of schedules) {
    const occs = occurrencesInRange(s, from, to);
    for (const date of occs) {
      const list = byDate.get(date) ?? [];
      const overdue = date < t;
      list.push({
        label: `${s.actionType.replace(/_/g, " ")} — ${s.tankName}`,
        overdue,
        variant: overdue ? "behind" : date === t ? "due" : "upcoming",
        schedule: s,
      });
      byDate.set(date, list);
    }
  }

  const monthPlanned = [...byDate.entries()].filter(([d]) => d.slice(0, 7) === month).reduce((a, [, v]) => a + v.length, 0);
  const monthBehind = [...byDate.entries()].filter(([d]) => d.slice(0, 7) === month && d < t).reduce((a, [, v]) => a + v.length, 0);

  const prevMonth = shiftMonth(month, -1);
  const nextMonth = shiftMonth(month, 1);

  return (
    <main className="flex-1 pb-20 lg:pb-8 p-4 lg:p-8 max-w-4xl">
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold">{monthLabel(month).split(" ")[0]}</h1>
          <span className="text-sm tnum" style={{ color: "var(--muted-foreground)" }}>
            {monthPlanned} planned{monthBehind > 0 ? ` · ${monthBehind} behind` : ""}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/calendar?m=${prevMonth}`}
            className="rounded-lg px-3 py-2 text-sm"
            style={{ background: "transparent", boxShadow: "inset 0 0 0 1px rgba(233,233,237,0.14)", color: "var(--muted-foreground)", minHeight: 44 }}
          >
            ←
          </Link>
          <Link
            href={`/calendar?m=${nextMonth}`}
            className="rounded-lg px-3 py-2 text-sm"
            style={{ background: "transparent", boxShadow: "inset 0 0 0 1px rgba(233,233,237,0.14)", color: "var(--muted-foreground)", minHeight: 44 }}
          >
            →
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1.5 mb-1.5">
        {WEEKDAY_LABELS.map((w) => (
          <div key={w} className="text-xs text-center py-1" style={{ color: "var(--muted-foreground)" }}>
            {w}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1.5">
        {days.map((d) => {
          const inMonth = d.slice(0, 7) === month;
          const isToday = d === t;
          const tasks = byDate.get(d) ?? [];
          return (
            <div
              key={d}
              className="rounded-lg p-1.5 min-h-[72px] sm:min-h-[92px] text-xs"
              style={{
                background: isToday ? "rgba(145,132,217,0.14)" : "rgba(15,17,28,0.4)",
                boxShadow: isToday ? "inset 0 0 0 1px var(--accent)" : "inset 0 0 0 1px rgba(233,233,237,0.05)",
                opacity: inMonth ? 1 : 0.32,
              }}
            >
              <div className="font-medium tnum mb-1.5 text-center" style={{ color: isToday ? "var(--accent-light)" : "rgba(233,233,237,0.65)" }}>
                {Number(d.slice(8, 10))}
              </div>
              <div className="flex flex-col gap-[3px] items-center">
                {tasks.slice(0, 3).map((task, i) => (
                  <CalendarChip key={i} schedule={task.schedule} label={task.label} variant={task.variant} />
                ))}
                {tasks.length > 3 && (
                  <div style={{ color: "var(--muted-foreground)", fontSize: "9px" }}>+{tasks.length - 3}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {schedules.length === 0 && (
        <div className="rounded-xl p-8 text-center mt-6 edge-card">
          <p style={{ color: "var(--muted-foreground)" }}>No schedules yet — add care schedules on a tank&apos;s page.</p>
        </div>
      )}

      {/* today's tasks (design: date heading + rows under the grid) */}
      {(byDate.get(t) ?? []).length > 0 && (
        <div className="mt-6">
          <div className="text-xs uppercase tracking-widest mb-2" style={{ color: "var(--muted-foreground)" }}>
            Today
          </div>
          <div className="flex flex-col gap-2">
            {(byDate.get(t) ?? []).map((task, i) => (
              <div key={i} className="flex items-center gap-3 rounded-lg px-3.5 py-2.5 edge-card">
                <span className="flex-1 text-sm">{task.label}</span>
                <span
                  className="text-xs px-2 py-1 rounded-md tnum"
                  style={{
                    background: task.overdue ? "var(--warning-soft)" : "var(--due-soft)",
                    color: task.overdue ? "var(--warning)" : "var(--due)",
                  }}
                >
                  {task.overdue ? "behind" : "due"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ICS subscribe hint (design) */}
      <div className="mt-6 flex items-center gap-2.5 rounded-lg px-3.5 py-3 edge-card">
        <i aria-hidden className="ph ph-rss-simple text-base" style={{ color: "var(--accent)" }} />
        <span className="flex-1 text-xs" style={{ color: "var(--muted-foreground)" }}>
          Subscribe to this plan from a calendar app
        </span>
        <Link href="/more" className="text-xs underline" style={{ color: "var(--accent)" }}>
          manage
        </Link>
      </div>
    </main>
  );
}
