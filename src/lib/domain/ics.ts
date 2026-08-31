/**
 * ICS (RFC 5545) feed generation — TechDesign v1.2 §4.4.
 *
 * Event identity (Plan-Review N.1, do not deviate):
 * - UID     = `{scheduleId}-{originalDueAt}@aquaman` — keyed on the
 *             occurrence's immutable originalDueAt, NEVER the planned date.
 *             plannedFor drifts daily for an overdue occurrence (it's a
 *             projection over `today`); a date-keyed UID would churn daily
 *             and Google would see delete+recreate instead of a move —
 *             losing reminders and flashing duplicates during its
 *             non-transactional refresh.
 * - DTSTART = plannedFor (the UID's twin carries the movement instead)
 * - SEQUENCE = scheduleVersion + missedSlots — monotonic, purely computable
 *             from the schedule row + `today`, so it actually can increase
 *             (a date-keyed UID could never let SEQUENCE do anything, since
 *             a changed date meant a brand new UID, never the same one again)
 * - DTSTAMP = schedule.updatedAt, NEVER `now` — otherwise the feed can never
 *             be byte-identical for identical inputs (see agent_docs/testing.md)
 *
 * Determinism: for the SAME schedule rows and the SAME injected `now`, the
 * output is byte-identical — events are sorted by (scheduleId, originalDueAt)
 * before rendering, not by insertion order or wall-clock anything.
 */
import {
  occurrenceDetailsInRange,
  missedSlots,
  type ScheduleLike,
} from "./scheduler";
import { today as todayStr, addDays, toIcsDate } from "./dates";
import { actionLabel } from "./action-types";

export const ICS_HORIZON_DAYS = 90;

export type IcsSchedule = ScheduleLike & {
  id: number;
  tankId: number;
  actionType: string;
  tankName: string;
  scheduleVersion: number;
  updatedAt: string; // ISO-8601 UTC
  active: boolean;
  /** issue #30: free-text instructions → ICS DESCRIPTION */
  details?: string | null;
};

/** RFC 5545 §3.3.11 text escaping. */
function escapeText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

/** RFC 5545 §3.1 line folding: max 75 octets/line, continuation lines start with a space. */
function foldLine(line: string): string {
  const bytes = Buffer.byteLength(line, "utf8");
  if (bytes <= 75) return line;
  const out: string[] = [];
  let rest = line;
  let first = true;
  while (Buffer.byteLength(rest, "utf8") > (first ? 75 : 74)) {
    const limit = first ? 75 : 74;
    // walk back from the byte limit to a safe (non-surrogate, non-multibyte-split) char boundary
    let cut = Math.min(rest.length, limit);
    while (cut > 0 && Buffer.byteLength(rest.slice(0, cut), "utf8") > limit) cut--;
    out.push((first ? "" : " ") + rest.slice(0, cut));
    rest = rest.slice(cut);
    first = false;
  }
  out.push(" " + rest);
  return out.join("\r\n");
}

/** ISO-8601 UTC instant → ICS UTC form YYYYMMDDTHHMMSSZ. */
function toIcsDateTimeUtc(iso: string): string {
  return iso.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z").slice(0, 16) + (iso.endsWith("Z") ? "" : "Z");
}

function buildVEvent(
  schedule: IcsSchedule,
  occ: { originalDueAt: string; plannedFor: string },
  now: Date,
  tz?: string,
): string {
  const uid = `${schedule.id}-${occ.originalDueAt}@aquaman`;
  // must pass the SAME (now, tz) used for occurrence expansion — otherwise
  // SEQUENCE reads real wall-clock time and the byte-identity contract breaks
  const sequence = schedule.scheduleVersion + missedSlots(schedule, now, tz);
  const summary = escapeText(`Aquaman: ${actionLabel(schedule.actionType)} — ${schedule.tankName}`);
  const dtstart = toIcsDate(occ.plannedFor);
  const dtend = toIcsDate(addDays(occ.plannedFor, 1)); // exclusive end, per RFC 5545 all-day convention
  // issue #30: concrete instructions (dosage, liters) travel in DESCRIPTION
  const lines = [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${toIcsDateTimeUtc(schedule.updatedAt)}`,
    `DTSTART;VALUE=DATE:${dtstart}`,
    `DTEND;VALUE=DATE:${dtend}`,
    `SEQUENCE:${sequence}`,
    `SUMMARY:${summary}`,
    ...(schedule.details
      ? [`DESCRIPTION:${escapeText(schedule.details)}`]
      : []),
    "END:VEVENT",
  ];
  return lines.map(foldLine).join("\r\n");
}

/**
 * Build the full VCALENDAR text for all active schedules. Deterministic for
 * identical (schedules, now) — the byte-identity contract from
 * agent_docs/testing.md.
 */
export function buildIcsFeed(
  schedules: IcsSchedule[],
  now: Date = new Date(),
  tz?: string,
): string {
  const from = todayStr(tz, now);
  const to = addDays(from, ICS_HORIZON_DAYS);

  type Row = { scheduleId: number; originalDueAt: string; block: string };
  const rows: Row[] = [];

  for (const s of schedules) {
    if (!s.active) continue;
    for (const occ of occurrenceDetailsInRange(s, from, to, now, tz)) {
      rows.push({ scheduleId: s.id, originalDueAt: occ.originalDueAt, block: buildVEvent(s, occ, now, tz) });
    }
  }

  rows.sort((a, b) =>
    a.scheduleId !== b.scheduleId
      ? a.scheduleId - b.scheduleId
      : a.originalDueAt < b.originalDueAt
        ? -1
        : a.originalDueAt > b.originalDueAt
          ? 1
          : 0,
  );

  const header = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Aquaman//Aquarium Care Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Aquaman",
  ];
  const footer = ["END:VCALENDAR"];

  return [...header, ...rows.map((r) => r.block), ...footer].join("\r\n") + "\r\n";
}
