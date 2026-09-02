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
import { TankFilterBar } from "@/components/tank-filter-bar";
import { formatDateLong, formatDateShort, t, plural } from "@/i18n";
import { getLocale } from "@/lib/settings";

export const dynamic = "force-dynamic";

// Date labels come from i18n/format.ts — they used to hardcode "en-US" and
// hand-assemble "Monday 24 August", which has no German word order at all.

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ day?: string; tank?: string }> }) {
  const { day: dayParam, tank: tankParam } = await searchParams;
  const locale = getLocale();
  const tanks = listTanks();
  const schedules = listSchedules();
  const { db } = await import("@/lib/db");
  const { maintenanceLogs } = await import("@/lib/db/schema");
  const allLogs = db.select().from(maintenanceLogs).all();
  // Streak stays global on purpose — it tracks the habit of caring for the
  // whole fishroom, not one tank, so the tank filter below never touches it.
  const streak = careStreak(schedules, allLogs);

  // Tank filter (?tank=<id>): a value that doesn'today match a live tank falls
  // back to "all", same defensive pattern as the feeding day param below.
  const selectedTankId = tankParam && tanks.some((tk) => String(tk.id) === tankParam) ? Number(tankParam) : null;
  const visibleTanks = selectedTankId === null ? tanks : tanks.filter((tk) => tk.id === selectedTankId);
  const visibleSchedules = selectedTankId === null ? schedules : schedules.filter((s) => s.tankId === selectedTankId);

  const week = weeklySummary(new Date(), selectedTankId ?? undefined);
  const cross = crossTankStats(new Date(), selectedTankId ?? undefined);
  // adherence over the last 30 d: share of schedules closed on/within 1 d of due
  const adherences = visibleSchedules
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
  const today = todayStr();
  const weekEnd = addDays(today, 7);
  // feeding day navigation (?day=YYYY-MM-DD): anything the feed action would
  // reject — non-dates, the future, beyond the backfill window — falls back to
  // today, so the arrows never render a day whose stepper would fail
  const minDay = feedMinDay(today);
  const day = resolveFeedDay(dayParam, today);
  const prevDay = day > minDay ? addDays(day, -1) : null;
  const nextDay = day < today ? addDays(day, 1) : null;
  const feeds = feedAllToday(day);

  // Preserve whichever of ?day=/?tank= isn'today being changed by a given link —
  // day navigation must not reset the tank filter and vice versa.
  const hrefFor = (overrides: { day?: string; tank?: string | null }) => {
    const params = new URLSearchParams();
    const nextDayVal = overrides.day ?? day;
    const nextTankVal = overrides.tank !== undefined ? overrides.tank : selectedTankId !== null ? String(selectedTankId) : null;
    if (nextDayVal !== today) params.set("day", nextDayVal);
    if (nextTankVal !== null) params.set("tank", nextTankVal);
    const qs = params.toString();
    return qs ? `/?${qs}` : "/";
  };

  // Closed today: these keep their place in the care queue with an Undo
  // control instead of silently reappearing under "coming up this week".
  // Derived from lastDoneAt, so the Undo survives the revalidation markDone
  // triggers — and a reload. Computed over the VISIBLE schedules, not `tasks`:
  // a task on a long interval is pushed past the one-week window the moment
  // it is closed, and would otherwise vanish outright.
  const doneTodayIds = new Set(visibleSchedules.filter((s) => doneOn(s, today)).map((s) => s.id));

  // projection for every visible schedule
  const tasks = visibleSchedules
    .map((s) => {
      const due = nextDue(s);
      const missed = missedSlots(s);
      return { s, due, missed, weight: catchUpWeight(s.actionType, due.overdueDays) };
    })
    .filter(({ due, s }) => due.plannedFor <= weekEnd || doneTodayIds.has(s.id));

  const closedToday = tasks.filter(({ s }) => doneTodayIds.has(s.id));
  const open = tasks.filter(({ s }) => !doneTodayIds.has(s.id));
  const dueToday = open.filter(({ due }) => due.plannedFor <= today);
  const behind = open.filter(({ due }) => due.plannedFor > today && due.overdueDays > 0);
  const upcoming = open.filter(({ due }) => due.plannedFor > today && due.overdueDays === 0);
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
    // Tank name only in the "All tanks" view — filtered to one tank it's redundant.
    return <ScheduleCard key={s.id} schedule={{ ...s, due, today: today }} tanks={tanks} doneToday={doneTodayIds.has(s.id)} showTankName={selectedTankId === null} />;
  };

  return (
    <main className="flex-1 pb-20 lg:pb-8 p-4 lg:p-8 max-w-3xl">
      {/* Page header (design): date label + "Today" + streak badge */}
      <PageHeader
        eyebrow={formatDateLong(today, locale)}
        title={t("dashboard.today", locale)}
        action={
          tanks.length > 0 && (
            <span
              className="chip py-1.5"
              style={{ "--chip-bg": "var(--due-soft)", boxShadow: "inset 0 0 0 1px var(--due-edge)" } as React.CSSProperties}
            >
              <i aria-hidden className="ph-fill ph-drop text-sm" style={{ color: "var(--due)" }} />
              <span className="text-sm font-medium tnum" style={{ color: "var(--foreground)" }}>{streak}</span>
              <span style={{ color: "var(--muted-foreground)" }}>{plural("dashboard.streakLabel", streak, locale)}</span>
              <HelpDot id="streak" />
            </span>
          )
        }
      />

      {/* Tank filter: "All" or one tank — narrows every section below except the streak badge above */}
      <TankFilterBar
        tanks={tanks}
        selectedTankId={selectedTankId}
        hrefFor={(id) => hrefFor({ tank: id === null ? null : String(id) })}
        locale={locale}
      />

      {/* Feeding (daily habit) — day navigation lets you backfill past days */}
      {visibleTanks.length > 0 && (
        <section className="mb-6">
          <div className="rounded-xl p-4 edge-card">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs uppercase tracking-wide" style={{ color: "var(--muted-foreground)" }}>
                {day === today ? t("dashboard.feedingToday", locale) : t("dashboard.feedingBackfill", locale)}
              </div>
              <div className="flex items-center gap-1">
                {prevDay ? (
                  <Link href={hrefFor({ day: prevDay })} aria-label={t("dashboard.previousDay", locale)} className="icon-btn icon-btn-sm">
                    <i aria-hidden className="ph ph-caret-left text-sm" />
                  </Link>
                ) : (
                  <span aria-hidden className="icon-btn icon-btn-sm icon-btn-bare" style={{ color: "var(--control-disabled)" }}>
                    <i className="ph ph-caret-left text-sm" />
                  </span>
                )}
                <span
                  className="text-xs tnum text-center"
                  style={{ minWidth: 92, color: day === today ? "var(--muted-foreground)" : "var(--due)" }}
                  aria-label={day === today ? t("dashboard.showingToday", locale) : t("dashboard.showingDay", locale, { date: day })}
                >
                  {day === today ? t("dashboard.today", locale) : formatDateShort(day, locale)}
                </span>
                {nextDay ? (
                  <Link href={hrefFor({ day: nextDay })} aria-label={t("dashboard.nextDay", locale)} className="icon-btn icon-btn-sm">
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
              {visibleTanks.map((tank) => (
                <FeedControl key={tank.id} tankId={tank.id} tankName={tank.name} day={day}
                  timesFed={feeds.find((f) => f.tankId === tank.id)?.timesFed ?? 0} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Adherence · 30 d (design) */}
      {visibleTanks.length > 0 && avgAdherence !== null && (
        <div className="panel-card rounded-xl p-4 mb-4 flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-widest mb-1 flex items-center gap-0.5" style={{ color: "var(--muted-foreground)" }}>
              {t("dashboard.adherenceTitle", locale)}
              <HelpDot id="adherence" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-medium tnum">{avgAdherence}</span>
              <span className="text-sm" style={{ color: "var(--muted-foreground)" }}>%</span>
            </div>
            <div className="text-xs tnum mt-1" style={{ color: "var(--faint)" }}>
              {selectedTankId === null
                ? plural("dashboard.actionsAcrossTanks", visibleTanks.length, locale, {
                    actions: plural("dashboard.careActions", cross.actions, locale),
                  })
                : t("dashboard.actionsInTank", locale, {
                    actions: plural("dashboard.careActions", cross.actions, locale),
                    tank: visibleTanks[0].name,
                  })}
            </div>
          </div>
          <span
            className="chip tnum"
            style={{
              "--chip-bg": avgAdherence >= 80 ? "var(--success-soft)" : "var(--warning-soft)",
              "--chip-fg": avgAdherence >= 80 ? "var(--success)" : "var(--warning)",
            } as React.CSSProperties}
          >
            {avgAdherence >= 80 ? t("dashboard.onTrack", locale) : t("dashboard.catchingUp", locale)}
          </span>
        </div>
      )}

      {/* KPIs */}
      <section className="grid grid-cols-3 gap-3 mb-6">
        {kpi(t("dashboard.dueToday", locale), dueToday.length, dueToday.length > 0 ? "var(--accent)" : "var(--success)")}
        {kpi(t("dashboard.behind", locale), behind.length, behind.length > 0 ? "var(--warning)" : undefined, "behindKpi")}
        {kpi(t("dashboard.thisWeek", locale), upcoming.length)}
      </section>

      {/* Catch-up */}
      {catchUpCandidate && (
        <div className="rounded-xl p-5 mb-6" style={{ background: "var(--warning-soft)", boxShadow: "inset 0 0 0 1px var(--warning-edge)" }}>
          <div className="text-xs uppercase tracking-wide mb-2" style={{ color: "var(--muted-foreground)" }}>
            {t("dashboard.catchUpTitle", locale)}
          </div>
          <ScheduleCard schedule={{ ...catchUpCandidate.s, due: catchUpCandidate.due, today: today }} tanks={tanks} showTankName={selectedTankId === null} />
          <div className="text-xs mt-1" style={{ color: "var(--muted-foreground)" }}>
            {plural("dashboard.catchUpMore", behind.length - 1, locale)}
          </div>
          <HelpNote id="catchUp" />
        </div>
      )}

      {/* Care queue (design: "tap a card to edit") */}
      <section className="mb-6">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-lg font-semibold">{t("dashboard.careQueue", locale)}</h2>
          <span className="text-xs" style={{ color: "var(--faint)" }}>{t("dashboard.tapToEdit", locale)}</span>
        </div>
        {dueToday.length === 0 && (
          <div className="panel-card rounded-xl p-4 mb-3">
            <StatusNote tone="success">
              {plural("dashboard.queueClear", week.closed, locale)}
            </StatusNote>
          </div>
        )}
        {dueToday.length > 0 && <div className="space-y-3">{dueToday.map(card)}</div>}
        {closedToday.length > 0 && (
          <div className="mt-3">
            <div className="text-xs uppercase tracking-widest" style={{ color: "var(--muted-foreground)" }}>
              {t("dashboard.doneTodayHeading", locale, { n: closedToday.length })}
            </div>
            <HelpNote id="doneToday" className="mb-2 mt-0.5" />
            <div className="space-y-3">{closedToday.map(card)}</div>
          </div>
        )}
      </section>

      {/* Behind */}
      {behind.length > 0 && (
        <section className="mb-6">
          <h2 className="text-lg font-semibold mb-3">{t("dashboard.behindHeading", locale, { n: behind.length })}</h2>
          <div className="space-y-3">{behind.map(card)}</div>
        </section>
      )}

      {/* Upcoming */}
      {upcoming.length > 0 && (
        <section className="mb-6">
          <h2 className="text-lg font-semibold mb-3">{t("dashboard.upcomingHeading", locale)}</h2>
          <div className="space-y-3">{upcoming.map(card)}</div>
        </section>
      )}

      {/* Empty state */}
      {tanks.length === 0 && (
        <div className="rounded-xl p-8 text-center edge-card">
          <i aria-hidden className="ph ph-fish text-4xl" style={{ color: "var(--faint)" }} />
          <p className="mb-4 mt-3" style={{ color: "var(--muted-foreground)" }}>
            {t("dashboard.emptyTanks", locale)}
          </p>
          <Link
            href="/tanks/new"
            className="btn-outline inline-flex items-center gap-1.5 rounded-lg px-5 py-2.5 text-sm font-medium"
            style={{ minHeight: 44 }}
          >
            <i aria-hidden className="ph ph-plus" /> {t("dashboard.createTank", locale)}
          </Link>
        </div>
      )}
    </main>
  );
}
