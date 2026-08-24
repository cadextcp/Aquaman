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
  const byDate = new Map<string, { label: string; overdue: boolean; schedule: (typeof schedules)[number] }[]>();
  for (const s of schedules) {
    const occs = occurrencesInRange(s, from, to);
    for (const date of occs) {
      const list = byDate.get(date) ?? [];
      list.push({ label: `${s.actionType.replace(/_/g, " ")} — ${s.tankName}`, overdue: date < t, schedule: s });
      byDate.set(date, list);
    }
  }

  const prevMonth = shiftMonth(month, -1);
  const nextMonth = shiftMonth(month, 1);

  return (
    <main className="flex-1 pb-20 lg:pb-8 p-4 lg:p-8 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Calendar</h1>
        <div className="flex items-center gap-2">
          <Link
            href={`/calendar?m=${prevMonth}`}
            className="rounded-lg px-3 py-2 text-sm"
            style={{ background: "var(--secondary)", color: "var(--secondary-foreground)", minHeight: 44 }}
          >
            ←
          </Link>
          <div className="text-sm font-medium w-36 text-center">{monthLabel(month)}</div>
          <Link
            href={`/calendar?m=${nextMonth}`}
            className="rounded-lg px-3 py-2 text-sm"
            style={{ background: "var(--secondary)", color: "var(--secondary-foreground)", minHeight: 44 }}
          >
            →
          </Link>
        </div>
      </div>

      <p className="text-xs mb-4" style={{ color: "var(--muted-foreground)" }}>
        Subscribe to this plan in Google Calendar via the ICS feed —{" "}
        <Link href="/more" className="underline" style={{ color: "var(--accent)" }}>
          get the link in More
        </Link>
        .
      </p>

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
              <div className="font-medium tnum mb-1" style={{ color: isToday ? "var(--accent-light)" : "rgba(233,233,237,0.65)" }}>
                {Number(d.slice(8, 10))}
              </div>
              <div className="space-y-0.5">
                {tasks.slice(0, 3).map((task, i) => (
                  <CalendarChip key={i} schedule={task.schedule} label={task.label} overdue={task.overdue} />
                ))}
                {tasks.length > 3 && (
                  <div style={{ color: "var(--muted-foreground)", fontSize: "10px" }}>+{tasks.length - 3} more</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {schedules.length === 0 && (
        <div
          className="rounded-xl p-8 text-center mt-6"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        >
          <p style={{ color: "var(--muted-foreground)" }}>No schedules yet — add care schedules on a tank&apos;s page.</p>
        </div>
      )}
    </main>
  );
}
