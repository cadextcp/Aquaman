import Link from "next/link";
import { listTanks, listSchedules, feedAllToday } from "@/lib/repo";
import { nextDue, missedSlots, catchUpWeight, doneOn } from "@/lib/domain/scheduler";
import { careStreak } from "@/lib/domain/streak";
import { scheduleAdherence, crossTankStats, weeklySummary } from "@/lib/stats";
import { today as todayStr, addDays } from "@/lib/domain/dates";
import { feedMinDay, resolveFeedDay } from "@/lib/domain/feed-window";
import { ScheduleCard } from "@/components/schedule-card";
import { FeedControl } from "@/components/feed-checkbox";
import { PageHeader } from "@/components/ui/page-header";
import { HelpDot, HelpNote } from "@/components/ui/help";
import { StatusNote } from "@/components/ui/status-note";

export const dynamic = "force-dynamic";

/** "Monday 24 August" (design header label) — date-only string, UTC-safe. */
function fullDateLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const weekday = dt.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  const month = dt.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
  return `${weekday} ${d} ${month}`;
}

/** "Mon, Aug 25" for the feeding day navigation pill. */
function shortDateLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  const { day: dayParam } = await searchParams;
  const tanks = listTanks();
  const schedules = listSchedules();
  const { db } = await import("@/lib/db");
  const { maintenanceLogs } = await import("@/lib/db/schema");
  const allLogs = db.select().from(maintenanceLogs).all();
  const streak = careStreak(schedules, allLogs);
  const week = weeklySummary();
  const cross = crossTankStats();
  // adherence over the last 30 d: share of schedules closed on/within 1 d of due
  const adherences = schedules
    .map((sch) => ({
      s: sch,
      pct: scheduleAdherence(
        { id: sch.id, intervalDays: sch.intervalDays, preferredDays: sch.preferredDays, lastDoneAt: sch.lastDoneAt, createdAt: sch.createdAt, active: sch.active, endsOn: sch.endsOn },
        allLogs.filter((l) => l.tankId === sch.tankId && l.actionType === sch.actionType),
      ),
    }))
    .filter((a) => a.pct !== null);
  const avgAdherence =
    adherences.length > 0 ? Math.round(adherences.reduce((acc, a) => acc + (a.pct ?? 0), 0) / adherences.length) : null;
  const t = todayStr();
  const weekEnd = addDays(t, 7);
  // feeding day navigation (?day=YYYY-MM-DD): anything the feed action would
  // reject — non-dates, the future, beyond the backfill window — falls back to
  // today, so the arrows never render a day whose stepper would fail
  const minDay = feedMinDay(t);
  const day = resolveFeedDay(dayParam, t);
  const prevDay = day > minDay ? addDays(day, -1) : null;
  const nextDay = day < t ? addDays(day, 1) : null;
  const feeds = feedAllToday(day);

  // Closed today: these keep their place in the care queue with an Undo
  // control instead of silently reappearing under "coming up this week".
  // Derived from lastDoneAt, so the Undo survives the revalidation markDone
  // triggers — and a reload. Computed over ALL schedules, not `tasks`: a task
  // on a long interval is pushed past the one-week window the moment it is
  // closed, and would otherwise vanish outright.
  const doneTodayIds = new Set(schedules.filter((s) => doneOn(s, t)).map((s) => s.id));

  // projection for every schedule
  const tasks = schedules
    .map((s) => {
      const due = nextDue(s);
      const missed = missedSlots(s);
      return { s, due, missed, weight: catchUpWeight(s.actionType, due.overdueDays) };
    })
    .filter(({ due, s }) => due.plannedFor <= weekEnd || doneTodayIds.has(s.id));

  const closedToday = tasks.filter(({ s }) => doneTodayIds.has(s.id));
  const open = tasks.filter(({ s }) => !doneTodayIds.has(s.id));
  const dueToday = open.filter(({ due }) => due.plannedFor <= t);
  const behind = open.filter(({ due }) => due.plannedFor > t && due.overdueDays > 0);
  const upcoming = open.filter(({ due }) => due.plannedFor > t && due.overdueDays === 0);
  const catchUpCandidate = behind.length > 5 ? behind.sort((a, b) => b.weight - a.weight)[0] : null;

  const kpi = (label: string, value: number | string, color?: string, help?: string) => (
    <div className="rounded-xl p-4 edge-card">
      <div className="text-xs uppercase tracking-wide mb-1 flex items-center gap-0.5" style={{ color: "var(--muted-foreground)" }}>
        {label}
        {help && <HelpDot id={help} />}
      </div>
      <div className="text-2xl font-medium tnum" style={{ color }}>{value}</div>
    </div>
  );

  const card = (item: (typeof tasks)[number]) => {
    const { s, due } = item;
    return <ScheduleCard key={s.id} schedule={{ ...s, due, today: t }} doneToday={doneTodayIds.has(s.id)} />;
  };

  return (
    <main className="flex-1 pb-20 lg:pb-8 p-4 lg:p-8 max-w-3xl">
      {/* Page header (design): date label + "Today" + streak badge */}
      <PageHeader
        eyebrow={fullDateLabel(t)}
        title="Today"
        action={
          tanks.length > 0 && (
            <span
              className="chip py-1.5"
              style={{ "--chip-bg": "var(--due-soft)", boxShadow: "inset 0 0 0 1px var(--due-edge)" } as React.CSSProperties}
            >
              <i aria-hidden className="ph-fill ph-drop text-sm" style={{ color: "var(--due)" }} />
              <span className="text-sm font-medium tnum" style={{ color: "var(--foreground)" }}>{streak}</span>
              <span style={{ color: "var(--muted-foreground)" }}>day streak</span>
              <HelpDot id="streak" />
            </span>
          )
        }
      />

      {/* Feeding (daily habit) — day navigation lets you backfill past days */}
      {tanks.length > 0 && (
        <section className="mb-6">
          <div className="rounded-xl p-4 edge-card">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs uppercase tracking-wide" style={{ color: "var(--muted-foreground)" }}>
                Feeding{day === t ? " today" : " · backfill"}
              </div>
              <div className="flex items-center gap-1">
                {prevDay ? (
                  <Link href={`/?day=${prevDay}`} aria-label="Previous day" className="icon-btn icon-btn-sm">
                    <i aria-hidden className="ph ph-caret-left text-sm" />
                  </Link>
                ) : (
                  <span aria-hidden className="icon-btn icon-btn-sm icon-btn-bare" style={{ color: "var(--control-disabled)" }}>
                    <i className="ph ph-caret-left text-sm" />
                  </span>
                )}
                <span
                  className="text-xs tnum text-center"
                  style={{ minWidth: 92, color: day === t ? "var(--muted-foreground)" : "var(--due)" }}
                  aria-label={day === t ? "Showing today" : `Showing ${day}`}
                >
                  {day === t ? "Today" : shortDateLabel(day)}
                </span>
                {nextDay ? (
                  <Link href={nextDay === t ? "/" : `/?day=${nextDay}`} aria-label="Next day" className="icon-btn icon-btn-sm">
                    <i aria-hidden className="ph ph-caret-right text-sm" />
                  </Link>
                ) : (
                  <span aria-hidden className="icon-btn icon-btn-sm icon-btn-bare" style={{ color: "var(--control-disabled)" }}>
                    <i className="ph ph-caret-right text-sm" />
                  </span>
                )}
              </div>
            </div>
            <HelpNote id="feeding" className="mt-0" />
            <HelpNote id="feedBackfill" className="mb-3 mt-1" />
            <div className="flex flex-col gap-2">
              {tanks.map((tank) => (
                <FeedControl key={tank.id} tankId={tank.id} tankName={tank.name} day={day}
                  timesFed={feeds.find((f) => f.tankId === tank.id)?.timesFed ?? 0} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Adherence · 30 d (design) */}
      {tanks.length > 0 && avgAdherence !== null && (
        <div className="panel-card rounded-xl p-4 mb-4 flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-widest mb-1 flex items-center gap-0.5" style={{ color: "var(--muted-foreground)" }}>
              Adherence · 30 d
              <HelpDot id="adherence" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-medium tnum">{avgAdherence}</span>
              <span className="text-sm" style={{ color: "var(--muted-foreground)" }}>%</span>
            </div>
            <div className="text-xs tnum mt-1" style={{ color: "var(--faint)" }}>
              {cross.actions} care actions across {tanks.length} tank{tanks.length === 1 ? "" : "s"}
            </div>
          </div>
          <span
            className="chip tnum"
            style={{
              "--chip-bg": avgAdherence >= 80 ? "var(--success-soft)" : "var(--warning-soft)",
              "--chip-fg": avgAdherence >= 80 ? "var(--success)" : "var(--warning)",
            } as React.CSSProperties}
          >
            {avgAdherence >= 80 ? "on track" : "catching up"}
          </span>
        </div>
      )}

      {/* KPIs */}
      <section className="grid grid-cols-3 gap-3 mb-6">
        {kpi("Due today", dueToday.length, dueToday.length > 0 ? "var(--accent)" : "var(--success)")}
        {kpi("Behind", behind.length, behind.length > 0 ? "var(--warning)" : undefined, "behindKpi")}
        {kpi("This week", upcoming.length)}
      </section>

      {/* Catch-up */}
      {catchUpCandidate && (
        <div className="rounded-xl p-5 mb-6" style={{ background: "var(--warning-soft)", boxShadow: "inset 0 0 0 1px var(--warning-edge)" }}>
          <div className="text-xs uppercase tracking-wide mb-2" style={{ color: "var(--muted-foreground)" }}>
            If you only do one thing today
          </div>
          <ScheduleCard schedule={{ ...catchUpCandidate.s, due: catchUpCandidate.due, today: t }} />
          <div className="text-xs mt-1" style={{ color: "var(--muted-foreground)" }}>
            {behind.length - 1} more tasks behind — they keep rescheduling to your preferred days, no rush.
          </div>
          <HelpNote id="catchUp" />
        </div>
      )}

      {/* Care queue (design: "tap a card to edit") */}
      <section className="mb-6">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-lg font-semibold">Care queue</h2>
          <span className="text-xs" style={{ color: "var(--faint)" }}>tap a card to edit</span>
        </div>
        {dueToday.length === 0 && (
          <div className="panel-card rounded-xl p-4 mb-3">
            <StatusNote tone="success">
              Queue clear — {week.closed} task{week.closed === 1 ? "" : "s"} closed this week, zero behind.
            </StatusNote>
          </div>
        )}
        {dueToday.length > 0 && <div className="space-y-3">{dueToday.map(card)}</div>}
        {closedToday.length > 0 && (
          <div className="mt-3">
            <div className="text-xs uppercase tracking-widest" style={{ color: "var(--muted-foreground)" }}>
              Done today ({closedToday.length})
            </div>
            <HelpNote id="doneToday" className="mb-2 mt-0.5" />
            <div className="space-y-3">{closedToday.map(card)}</div>
          </div>
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
        <div className="rounded-xl p-8 text-center edge-card">
          <i aria-hidden className="ph ph-fish text-4xl" style={{ color: "var(--faint)" }} />
          <p className="mb-4 mt-3" style={{ color: "var(--muted-foreground)" }}>
            No tanks yet — create your first tank to get started.
          </p>
          <Link
            href="/tanks/new"
            className="btn-outline inline-flex items-center gap-1.5 rounded-lg px-5 py-2.5 text-sm font-medium"
            style={{ minHeight: 44 }}
          >
            <i aria-hidden className="ph ph-plus" /> Create tank
          </Link>
        </div>
      )}
    </main>
  );
}
