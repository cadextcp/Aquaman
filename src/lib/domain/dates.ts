/**
 * Timezone-safe date helpers — ALL "today"/"midnight" logic goes through here.
 * AQUAMAN_TIMEZONE (default Europe/Berlin). Never use Date.setHours(0,0,0,0)
 * or Date.getDay() (0 = Sunday trap) — see AGENTS.md gotchas.
 *
 * Core convention: scheduler/ICS work with **date strings** (YYYY-MM-DD),
 * not instants — day arithmetic has no timezone drift that way.
 */

export const APP_TZ = process.env.AQUAMAN_TIMEZONE ?? "Europe/Berlin";

/** Format an instant as YYYY-MM-DD in the app timezone. */
export function localDateStr(date: Date, tz: string = APP_TZ): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** tz offset (ms) of `date` — positive if tz is ahead of UTC. */
function tzOffsetMs(date: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return asUtc - date.getTime();
}

/**
 * Start of the local day (midnight in app tz) as a UTC instant. Two-pass for DST.
 * NOTE (issue #19): this is the INSTANT-based counterpart to today()/localDateStr()
 * (string-based). Reserved for features that need a Date boundary (e.g. aiCalls
 * bucketing, uptime-style ranges) — scheduler/ICS intentionally stay string-based.
 * Do not delete as "unused"; do not duplicate its logic elsewhere.
 */
export function startOfLocalDay(date: Date, tz: string = APP_TZ): Date {
  const ymd = localDateStr(date, tz);
  const naive = Date.parse(`${ymd}T00:00:00Z`); // pretend UTC first
  const t1 = new Date(naive);
  const offset = tzOffsetMs(t1, tz); // offset around that instant
  return new Date(naive - offset);
}

/**
 * Weekday index with Monday = 0 … Sunday = 6 — matches the 7-bit mask
 * convention (bit 0 = Mon). Date.getDay() returns 0 = SUNDAY; never use raw.
 */
export function localWeekdayIndex(date: Date, tz: string = APP_TZ): number {
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(date);
  const map: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  const idx = map[wd];
  if (idx === undefined) throw new Error(`localWeekdayIndex: unexpected weekday "${wd}"`);
  return idx;
}

/**
 * Add n days to a **date-only** value (YYYY-MM-DD string) — pure UTC day math.
 * Returns YYYY-MM-DD.
 */
export function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

/** Weekday index (Mon=0…Sun=6) of a YYYY-MM-DD string — UTC-based, no tz drift. */
export function weekdayOf(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (dt.getUTCDay() + 6) % 7; // JS: 0=Sun → shift to 0=Mon
}

/** Today as YYYY-MM-DD in app timezone. */
export function today(tz: string = APP_TZ, now: Date = new Date()): string {
  return localDateStr(now, tz);
}

/** ISO date string → compact ICS form YYYYMMDD. */
export function toIcsDate(dateStr: string): string {
  return dateStr.replace(/-/g, "");
}

/** True if the weekday bit for `dateStr` is set in the 7-bit mask. */
export function dayMatchesMask(dateStr: string, mask: number): boolean {
  return ((mask >> weekdayOf(dateStr)) & 1) === 1;
}

/** Parse ISO-8601 UTC timestamp → local YYYY-MM-DD in app tz. */
export function isoToLocalDate(iso: string, tz: string = APP_TZ): string {
  return localDateStr(new Date(iso), tz);
}

/** Last day-of-month (1–31) for a YYYY-MM month string, pure UTC calendar math. */
export function daysInMonth(monthStr: string): number {
  const [y, m] = monthStr.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate(); // day 0 of next month = last day of this month
}

/**
 * Monday-start 6-or-fewer-week grid covering a calendar month, padded with
 * the trailing days of the previous/next month so every row is a full week
 * (Mon…Sun) — the shape a month-view calendar needs to render.
 */
export function monthGridRange(monthStr: string): { from: string; to: string; days: string[] } {
  const first = `${monthStr}-01`;
  const last = `${monthStr}-${String(daysInMonth(monthStr)).padStart(2, "0")}`;
  const from = addDays(first, -weekdayOf(first));
  const to = addDays(last, 6 - weekdayOf(last));
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return { from, to, days };
}

/** Previous/next YYYY-MM month string (pure, no Date-object month-rollover surprises). */
export function shiftMonth(monthStr: string, delta: number): string {
  const [y, m] = monthStr.split("-").map(Number);
  const total = y * 12 + (m - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12;
  return `${ny}-${String(nm + 1).padStart(2, "0")}`;
}
