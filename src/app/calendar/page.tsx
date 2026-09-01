import Link from "next/link";
import { listTanks, listSchedules } from "@/lib/repo";
import { occurrencesInRange } from "@/lib/domain/scheduler";
import { CalendarChip } from "@/components/calendar-chip";
import { today as todayStr, monthGridRange, shiftMonth } from "@/lib/domain/dates";
import { PageHeader } from "@/components/ui/page-header";
import { CalendarLegend } from "@/components/calendar-legend";
import { TankFilterBar } from "@/components/tank-filter-bar";

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
  searchParams: Promise<{ m?: string; tank?: string }>;
}) {
  const { m, tank: tankParam } = await searchParams;
  const t = todayStr();
  const month = m && /^\d{4}-\d{2}$/.test(m) ? m : t.slice(0, 7);

  const tanks = listTanks();
  // Same tank filter as the dashboard (?tank=<id>), carried over via the nav
  // when you switch pages — see TANK_SCOPED_PATHS in nav-item.tsx.
  const selectedTankId = tankParam && tanks.some((tk) => String(tk.id) === tankParam) ? Number(tankParam) : null;
  const allSchedules = listSchedules();
  const schedules = selectedTankId === null ? allSchedules : allSchedules.filter((s) => s.tankId === selectedTankId);
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
        // tank name only in the "All tanks" view — filtered to one tank it's redundant
        label: selectedTankId === null ? `${s.actionType.replace(/_/g, " ")} — ${s.tankName}` : s.actionType.replace(/_/g, " "),
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

  // Preserve whichever of ?m=/?tank= isn't being changed by a given link —
  // month navigation must not reset the tank filter and vice versa.
  const hrefFor = (overrides: { m?: string; tank?: string | null }) => {
    const params = new URLSearchParams();
    const nextM = overrides.m ?? month;
    const nextTank = overrides.tank !== undefined ? overrides.tank : selectedTankId !== null ? String(selectedTankId) : null;
    if (nextM !== t.slice(0, 7)) params.set("m", nextM);
    if (nextTank !== null) params.set("tank", nextTank);
    const qs = params.toString();
    return qs ? `/calendar?${qs}` : "/calendar";
  };

  return (
    <main className="flex-1 pb-20 lg:pb-8 p-4 lg:p-8 max-w-4xl">
      <PageHeader
        title={monthLabel(month)}
        subtitle={
          <span className="tnum">
            {monthPlanned} planned{monthBehind > 0 ? ` · ${monthBehind} behind` : ""}
          </span>
        }
        action={
          <>
            {month !== t.slice(0, 7) && (
              <Link href={hrefFor({ m: t.slice(0, 7) })} className="btn-ghost rounded-lg px-3 text-xs inline-flex items-center" style={{ minHeight: 44 }}>
                Today
              </Link>
            )}
            <Link href={hrefFor({ m: prevMonth })} aria-label="Previous month" className="icon-btn">
              <i aria-hidden className="ph ph-caret-left text-base" />
            </Link>
            <Link href={hrefFor({ m: nextMonth })} aria-label="Next month" className="icon-btn">
              <i aria-hidden className="ph ph-caret-right text-base" />
            </Link>
          </>
        }
      />

      <TankFilterBar
        tanks={tanks}
        selectedTankId={selectedTankId}
        hrefFor={(id) => hrefFor({ tank: id === null ? null : String(id) })}
      />

      <CalendarLegend />

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
                background: isToday ? "var(--accent-soft)" : "rgba(15,17,28,0.4)",
                boxShadow: isToday ? "inset 0 0 0 1px var(--accent)" : "inset 0 0 0 1px var(--surface)",
                opacity: inMonth ? 1 : 0.32,
              }}
            >
              <div className="font-medium tnum mb-1.5 text-center" style={{ color: isToday ? "var(--accent-light)" : "var(--control-foreground)" }}>
                {Number(d.slice(8, 10))}
              </div>
              <div className="flex flex-col gap-[9px] items-center">
                {tasks.slice(0, 3).map((task, i) => (
                  <CalendarChip key={i} schedule={task.schedule} tanks={tanks} label={task.label} variant={task.variant} />
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
          <i aria-hidden className="ph ph-calendar-blank text-4xl" style={{ color: "var(--faint)" }} />
          <p className="mt-3" style={{ color: "var(--muted-foreground)" }}>
            No schedules yet — add care plans on a tank&apos;s page and their dates appear here.
          </p>
          <p className="text-xs mt-2" style={{ color: "var(--faint)" }}>
            You can subscribe to this plan from any calendar app.
          </p>
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
