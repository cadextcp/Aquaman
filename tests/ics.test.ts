import { describe, it, expect } from "vitest";
import { buildIcsFeed, type IcsSchedule } from "../src/lib/domain/ics";
import { ALL_DAYS_MASK } from "../src/lib/domain/scheduler";

const TZ = "Europe/Berlin";
const NOW = new Date("2026-08-20T10:00:00Z"); // Thursday

function sched(partial: Partial<IcsSchedule> = {}): IcsSchedule {
  return {
    id: 1,
    tankId: 1,
    tankName: "240L Community",
    actionType: "water_change",
    intervalDays: 7,
    preferredDays: ALL_DAYS_MASK,
    autoReschedule: true,
    lastDoneAt: "2026-08-08T10:00:00.000Z",
    snoozedUntil: null,
    createdAt: "2026-08-01T10:00:00.000Z",
    scheduleVersion: 0,
    updatedAt: "2026-08-08T10:00:00.000Z",
    active: true,
    ...partial,
  };
}

function uidsOf(feed: string): string[] {
  return [...feed.matchAll(/^UID:(.+)$/gm)].map((m) => m[1].trim());
}

function dtstartsOf(feed: string): string[] {
  return [...feed.matchAll(/^DTSTART;VALUE=DATE:(\d{8})$/gm)].map((m) => m[1]);
}

describe("buildIcsFeed — structure", () => {
  it("wraps events in a VCALENDAR with the expected header fields", () => {
    const feed = buildIcsFeed([sched()], NOW, TZ);
    expect(feed).toMatch(/^BEGIN:VCALENDAR\r\n/);
    expect(feed).toContain("VERSION:2.0\r\n");
    expect(feed).toContain("X-WR-CALNAME:Aquaman\r\n");
    expect(feed.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
    expect(feed).toContain("BEGIN:VEVENT");
    expect(feed).toContain("SUMMARY:Aquaman: Water change — 240L Community\r\n");
  });

  it("uses CRLF line endings throughout (RFC 5545)", () => {
    const feed = buildIcsFeed([sched()], NOW, TZ);
    expect(feed.includes("\r\n")).toBe(true);
    expect(feed.replace(/\r\n/g, "").includes("\n")).toBe(false);
  });

  it("inactive schedules produce no events", () => {
    const feed = buildIcsFeed([sched({ active: false })], NOW, TZ);
    expect(feed).not.toContain("BEGIN:VEVENT");
  });
});

describe("buildIcsFeed — determinism (agent_docs/testing.md contract)", () => {
  it("identical schedule rows + identical injected `now` → byte-identical feed", () => {
    const a = buildIcsFeed([sched(), sched({ id: 2, actionType: "fertilize" })], NOW, TZ);
    const b = buildIcsFeed([sched(), sched({ id: 2, actionType: "fertilize" })], NOW, TZ);
    expect(a).toBe(b);
  });

  it("output order does not depend on input order (sorted by scheduleId, originalDueAt)", () => {
    const s1 = sched({ id: 1 });
    const s2 = sched({ id: 2, actionType: "fertilize" });
    const a = buildIcsFeed([s1, s2], NOW, TZ);
    const b = buildIcsFeed([s2, s1], NOW, TZ);
    expect(a).toBe(b);
  });

  it("DTSTAMP comes from schedule.updatedAt, not wall-clock time", () => {
    const feed = buildIcsFeed([sched({ updatedAt: "2026-08-08T10:00:00.000Z" })], NOW, TZ);
    expect(feed).toContain("DTSTAMP:20260808T100000Z");
  });
});

describe("buildIcsFeed — event identity survives snooze/reschedule (Plan-Review N.1)", () => {
  it("snoozing the current occurrence changes DTSTART but keeps the SAME UID (no duplicate)", () => {
    const before = sched(); // overdue, no snooze — projects to a reschedule date
    const after = sched({ snoozedUntil: "2026-08-30T00:00:00.000Z", scheduleVersion: 1 });

    const feedBefore = buildIcsFeed([before], NOW, TZ);
    const feedAfter = buildIcsFeed([after], NOW, TZ);

    const uidBefore = uidsOf(feedBefore)[0];
    const uidAfter = uidsOf(feedAfter)[0];
    expect(uidAfter).toBe(uidBefore); // same occurrence, identified by originalDueAt

    const dtBefore = dtstartsOf(feedBefore)[0];
    const dtAfter = dtstartsOf(feedAfter)[0];
    expect(dtAfter).not.toBe(dtBefore); // but the displayed date moved
    expect(dtAfter).toBe("20260830");
  });

  it("UID is keyed on originalDueAt, not on the projected/planned date", () => {
    const feed = buildIcsFeed([sched()], NOW, TZ);
    // originalDueAt for this schedule = 2026-08-15 (lastDoneAt 08-08 + 7d, all-days mask)
    expect(uidsOf(feed)[0]).toBe("1-2026-08-15@aquaman");
  });

  it("SEQUENCE grows with scheduleVersion and with missedSlots (backlog growth)", () => {
    const feed1 = buildIcsFeed([sched({ scheduleVersion: 0 })], NOW, TZ);
    const feed2 = buildIcsFeed([sched({ scheduleVersion: 3 })], NOW, TZ);
    const seq = (f: string) => Number([...f.matchAll(/^SEQUENCE:(\d+)$/gm)][0][1]);
    expect(seq(feed2)).toBeGreaterThan(seq(feed1));
  });
});

describe("buildIcsFeed — 90-day horizon and multiple occurrences", () => {
  it("emits more than one VEVENT per schedule across the horizon", () => {
    const feed = buildIcsFeed([sched({ intervalDays: 7 })], NOW, TZ);
    const count = [...feed.matchAll(/BEGIN:VEVENT/g)].length;
    expect(count).toBeGreaterThan(5); // ~90 days / 7-day interval
  });

  it("text fields with special characters are escaped per RFC 5545 §3.3.11", () => {
    const feed = buildIcsFeed([sched({ tankName: "Tank; A, B\\C" })], NOW, TZ);
    expect(feed).toContain("Tank\\; A\\, B\\\\C");
  });
});

describe("buildIcsFeed — localized event titles", () => {
  it("defaults to English and keeps the historical SUMMARY wording", () => {
    const feed = buildIcsFeed([sched()], NOW, TZ);
    expect(feed).toContain("SUMMARY:Aquaman: Water change — 240L Community");
  });

  it("renders the SUMMARY in the app language", () => {
    const feed = buildIcsFeed([sched()], NOW, TZ, "de");
    expect(feed).toContain("SUMMARY:Aquaman: Wasserwechsel — 240L Community");
  });

  it("stays byte-identical per locale (determinism is not weakened by i18n)", () => {
    expect(buildIcsFeed([sched()], NOW, TZ, "de")).toBe(buildIcsFeed([sched()], NOW, TZ, "de"));
  });
});
