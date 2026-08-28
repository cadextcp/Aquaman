import { describe, it, expect } from "vitest";
import {
  nextDue,
  originalDueAt,
  missedSlots,
  occurrencesInRange,
  occurrenceDetailsInRange,
  nextPreferredDay,
  catchUpWeight,
  doneOn,
  ALL_DAYS_MASK,
  type ScheduleLike,
} from "../src/lib/domain/scheduler";

const TZ = "Europe/Berlin";

/** Helper: fixed "now" for deterministic tests. */
function at(iso: string): Date {
  return new Date(iso);
}

function sched(partial: Partial<ScheduleLike> = {}): ScheduleLike {
  return {
    intervalDays: 7,
    preferredDays: ALL_DAYS_MASK,
    autoReschedule: true,
    lastDoneAt: null,
    snoozedUntil: null,
    createdAt: "2026-08-01T10:00:00.000Z",
    ...partial,
  };
}

describe("nextPreferredDay (inclusive)", () => {
  const weekend = 0b1100000; // Sat + Sun
  it("fromStr itself matches → returned unchanged (INCLUSIVE)", () => {
    // 2026-08-22 is a Saturday
    expect(nextPreferredDay("2026-08-22", weekend)).toBe("2026-08-22");
  });
  it("Monday → next Saturday", () => {
    expect(nextPreferredDay("2026-08-24", weekend)).toBe("2026-08-29");
  });
  it("Sunday matches weekend mask → itself (inclusive)", () => {
    // 2026-08-23 IS a Sunday — inclusive semantics return it unchanged
    expect(nextPreferredDay("2026-08-23", weekend)).toBe("2026-08-23");
  });
  it("Wednesday → next Saturday", () => {
    expect(nextPreferredDay("2026-08-26", weekend)).toBe("2026-08-29");
  });
  it("mask 0 (invalid) → defensive fallback every day = fromStr", () => {
    expect(nextPreferredDay("2026-08-24", 0)).toBe("2026-08-24");
  });
});

describe("originalDueAt", () => {
  it("never moves: derived from lastDoneAt + interval, weekday-gridded once", () => {
    const s = sched({
      intervalDays: 10,
      preferredDays: 0b1100000, // weekend only
      lastDoneAt: "2026-08-01T12:00:00.000Z",
    });
    // base = 2026-08-11 (Tuesday) → next preferred day = Sat 2026-08-15
    expect(originalDueAt(s)).toBe("2026-08-15");
  });
  it("falls back to createdAt when never done", () => {
    const s = sched({ createdAt: "2026-08-10T08:00:00.000Z", intervalDays: 7 });
    expect(originalDueAt(s)).toBe("2026-08-17");
  });
});

describe("nextDue — core semantics", () => {
  it("base case: not overdue, no snooze → plannedFor = originalDueAt", () => {
    const s = sched({ intervalDays: 7, lastDoneAt: "2026-08-16T10:00:00.000Z" });
    // originalDue = 2026-08-23 (Sunday) — today (fixed) = 2026-08-20 → future
    const r = nextDue(s, at("2026-08-20T10:00:00Z"), TZ);
    expect(r.originalDueAt).toBe("2026-08-23");
    expect(r.plannedFor).toBe("2026-08-23");
    expect(r.overdueDays).toBe(0);
  });

  it("snooze ALWAYS wins for this occurrence", () => {
    const s = sched({
      intervalDays: 7,
      lastDoneAt: "2026-08-16T10:00:00.000Z", // due 2026-08-23
      snoozedUntil: "2026-08-27T00:00:00.000Z",
    });
    const r = nextDue(s, at("2026-08-21T10:00:00Z"), TZ);
    expect(r.plannedFor).toBe("2026-08-27");
    expect(r.originalDueAt).toBe("2026-08-23"); // honest, unmoved
  });

  it("auto-reschedule: overdue → next preferred day FROM TODAY (projection only)", () => {
    const s = sched({
      intervalDays: 7,
      preferredDays: 0b0100000, // Saturdays only
      lastDoneAt: "2026-08-08T10:00:00.000Z", // originalDue = Sat 2026-08-15
      snoozedUntil: null,
    });
    // today = Wednesday 2026-08-19 → next Saturday = 2026-08-22
    const r = nextDue(s, at("2026-08-19T10:00:00Z"), TZ);
    expect(r.originalDueAt).toBe("2026-08-15");
    expect(r.plannedFor).toBe("2026-08-22");
    expect(r.overdueDays).toBe(4); // honest backlog
  });

  it("autoReschedule OFF: overdue stays on original due (honest, unshifted)", () => {
    const s = sched({
      intervalDays: 7,
      autoReschedule: false,
      lastDoneAt: "2026-08-08T10:00:00.000Z", // due 2026-08-15
    });
    const r = nextDue(s, at("2026-08-19T10:00:00Z"), TZ);
    expect(r.plannedFor).toBe("2026-08-15");
    expect(r.overdueDays).toBe(4);
  });

  it("never moves backward: planned >= original always", () => {
    const s = sched({ intervalDays: 7, lastDoneAt: "2026-08-08T10:00:00.000Z" });
    const r = nextDue(s, at("2026-08-25T10:00:00Z"), TZ);
    expect(r.plannedFor >= r.originalDueAt).toBe(true);
  });

  it("originalDueAt stays the same whether viewed today or in 5 days (never drifts)", () => {
    const s = sched({
      intervalDays: 7,
      preferredDays: 0b0100000,
      lastDoneAt: "2026-08-08T10:00:00.000Z", // due Sat 2026-08-15
    });
    const r1 = nextDue(s, at("2026-08-19T10:00:00Z"), TZ);
    const r2 = nextDue(s, at("2026-08-24T10:00:00Z"), TZ);
    expect(r1.originalDueAt).toBe("2026-08-15");
    expect(r2.originalDueAt).toBe("2026-08-15"); // SAME — no daily UID churn
  });
});

describe("missedSlots", () => {
  it("0 when not overdue", () => {
    const s = sched({ lastDoneAt: "2026-08-20T10:00:00.000Z" }); // due 2026-08-27
    expect(missedSlots(s, at("2026-08-24T10:00:00Z"), TZ)).toBe(0);
  });

  it("counts preferred weekdays in (originalDue, today]", () => {
    const s = sched({
      intervalDays: 7,
      preferredDays: 0b0100000, // Saturdays
      lastDoneAt: "2026-08-08T10:00:00.000Z", // originalDue Sat 2026-08-15
    });
    // (2026-08-15, 2026-08-24] contains Sat 2026-08-22 → 1 missed slot
    expect(missedSlots(s, at("2026-08-24T10:00:00Z"), TZ)).toBe(1);
    // a day later still 1 (Sun 23rd, Mon 24th are no preferred days)
    // (2026-08-15, 2026-08-25] → still just Sat 22nd
    expect(missedSlots(s, at("2026-08-25T10:00:00Z"), TZ)).toBe(1);
    // after next Saturday: (…, 2026-08-30] → Sat 22 + Sat 29 → 2
    expect(missedSlots(s, at("2026-08-30T10:00:00Z"), TZ)).toBe(2);
  });

  it("daily mask counts every missed day", () => {
    const s = sched({ intervalDays: 1, lastDoneAt: "2026-08-20T10:00:00.000Z" }); // due 08-21
    expect(missedSlots(s, at("2026-08-24T10:00:00Z"), TZ)).toBe(3); // 22,23,24
  });
});

describe("occurrencesInRange (variant B: fixed grid from originalDueAt)", () => {
  it("future original: grid walks from original, gridded to preferred days", () => {
    const s = sched({
      intervalDays: 14,
      preferredDays: 0b0100000, // Saturdays
      createdAt: "2026-08-20T10:00:00.000Z",
      lastDoneAt: null,
    });
    // originalDue = 2026-09-03 (Thu) → gridded to Sat 2026-09-05
    const occ = occurrencesInRange(s, "2026-08-20", "2026-10-31", at("2026-08-20T10:00:00Z"), TZ);
    expect(occ[0]).toBe("2026-09-05");
    // grid: 09-05 + 14 = 09-19 (Sat), + 14 = 10-03 (Sat), +14 = 10-17, +14 = 10-31
    expect(occ).toEqual(["2026-09-05", "2026-09-19", "2026-10-03", "2026-10-17", "2026-10-31"]);
  });

  it("overdue + default policy (suppress@50): tight first grid point is skipped", () => {
    const s = sched({
      intervalDays: 14,
      preferredDays: 0b0100000, // Saturdays
      lastDoneAt: "2026-08-01T10:00:00.000Z", // originalDue Sat 2026-08-15
    });
    // today = 2026-08-20 (Thu) → projection: nextPreferredDay(today) = Sat 2026-08-22
    // grid from 08-15: +14 = 08-29 (gap 7d ≤ 50%·14d=7d → suppressed), +28 = 09-12, +42 = 09-26
    const occ = occurrencesInRange(s, "2026-08-20", "2026-09-30", at("2026-08-20T10:00:00Z"), TZ);
    expect(occ).toEqual(["2026-08-22", "2026-09-12", "2026-09-26"]);
  });

  it("tightGapPolicy 'fixed' (Option A): every grid point kept", () => {
    const s = sched({
      intervalDays: 14,
      preferredDays: 0b0100000,
      lastDoneAt: "2026-08-01T10:00:00.000Z",
      tightGapPolicy: "fixed",
    });
    const occ = occurrencesInRange(s, "2026-08-20", "2026-09-30", at("2026-08-20T10:00:00Z"), TZ);
    expect(occ).toEqual(["2026-08-22", "2026-08-29", "2026-09-12", "2026-09-26"]);
  });

  it("tightGapThresholdPct configurable: 30% keeps 08-29 (gap 7d > 30%·14d=4.2d)", () => {
    const s = sched({
      intervalDays: 14,
      preferredDays: 0b0100000,
      lastDoneAt: "2026-08-01T10:00:00.000Z",
      tightGapPolicy: "suppress",
      tightGapThresholdPct: 30,
    });
    const occ = occurrencesInRange(s, "2026-08-20", "2026-09-30", at("2026-08-20T10:00:00Z"), TZ);
    expect(occ).toEqual(["2026-08-22", "2026-08-29", "2026-09-12", "2026-09-26"]);
  });

  it("suppression never eats more than one grid point", () => {
    const s = sched({
      intervalDays: 7,
      preferredDays: ALL_DAYS_MASK,
      lastDoneAt: "2026-08-08T10:00:00.000Z", // originalDue 2026-08-15
    });
    // today 08-20 → projection 08-20; grid: 08-22 (gap 2 ≤ 3.5 → skip), 08-29, 09-05 …
    const occ = occurrencesInRange(s, "2026-08-20", "2026-09-05", at("2026-08-20T10:00:00Z"), TZ);
    expect(occ).toEqual(["2026-08-20", "2026-08-29", "2026-09-05"]);
  });

  it("no catch-up (not overdue): policy has no effect", () => {
    const s = sched({
      intervalDays: 14,
      preferredDays: 0b0100000,
      lastDoneAt: "2026-08-16T10:00:00.000Z", // raw due Sun 08-30 → gridded to Sat 09-05
      tightGapPolicy: "suppress",
    });
    const occ = occurrencesInRange(s, "2026-08-20", "2026-10-31", at("2026-08-20T10:00:00Z"), TZ);
    expect(occ).toEqual(["2026-09-05", "2026-09-19", "2026-10-03", "2026-10-17", "2026-10-31"]);
  });

  it("snoozed current occurrence appears at snooze date", () => {
    const s = sched({
      intervalDays: 14,
      preferredDays: 0b0100000,
      lastDoneAt: "2026-08-01T10:00:00.000Z", // due 2026-08-15
      snoozedUntil: "2026-08-26T00:00:00.000Z",
    });
    const occ = occurrencesInRange(s, "2026-08-20", "2026-09-30", at("2026-08-20T10:00:00Z"), TZ);
    expect(occ[0]).toBe("2026-08-26"); // snooze wins for current occurrence
  });
});

describe("occurrenceDetailsInRange (per-occurrence ICS identity)", () => {
  it("current occurrence: originalDueAt is the schedule's own original, plannedFor is the projection", () => {
    const s = sched({
      intervalDays: 7,
      preferredDays: 0b0100000, // Saturdays only
      lastDoneAt: "2026-08-08T10:00:00.000Z", // originalDue = Sat 2026-08-15
    });
    // today = Wednesday 2026-08-19 → overdue, projects to next Saturday 2026-08-22
    const details = occurrenceDetailsInRange(s, "2026-08-20", "2026-09-10", at("2026-08-19T10:00:00Z"), TZ);
    expect(details[0]).toEqual({ originalDueAt: "2026-08-15", plannedFor: "2026-08-22" });
  });

  it("future occurrences: originalDueAt equals plannedFor (never projected)", () => {
    const s = sched({
      intervalDays: 14,
      preferredDays: 0b0100000,
      createdAt: "2026-08-20T10:00:00.000Z",
      lastDoneAt: null,
    });
    const details = occurrenceDetailsInRange(s, "2026-08-20", "2026-10-31", at("2026-08-20T10:00:00Z"), TZ);
    for (const d of details) expect(d.originalDueAt).toBe(d.plannedFor);
    expect(details.map((d) => d.plannedFor)).toEqual(occurrencesInRange(s, "2026-08-20", "2026-10-31", at("2026-08-20T10:00:00Z"), TZ));
  });

  it("originalDueAt for the current occurrence stays stable across viewpoints (no daily UID churn)", () => {
    const s = sched({
      intervalDays: 10,
      preferredDays: 0b1100000, // weekend only
      lastDoneAt: "2026-08-01T12:00:00.000Z",
    });
    const before = occurrenceDetailsInRange(s, "2026-08-01", "2026-10-15", at("2026-08-10T10:00:00Z"), TZ);
    const after = occurrenceDetailsInRange(s, "2026-08-01", "2026-10-15", at("2026-08-20T10:00:00Z"), TZ);
    // the fixed-grid tail (everything but the current, catching-up occurrence)
    // must be byte-identical regardless of when you look — only the current
    // occurrence's plannedFor (and its position) may differ.
    expect(before.slice(1).map((d) => d.originalDueAt)).toEqual(after.slice(1).map((d) => d.originalDueAt));
  });

  it("occurrencesInRange is exactly occurrenceDetailsInRange's plannedFor projection", () => {
    const s = sched({ intervalDays: 7, preferredDays: 127, lastDoneAt: "2026-08-01T10:00:00.000Z" });
    const from = "2026-08-01", to = "2026-10-01", now = at("2026-08-20T10:00:00Z");
    expect(occurrencesInRange(s, from, to, now, TZ)).toEqual(
      occurrenceDetailsInRange(s, from, to, now, TZ).map((d) => d.plannedFor),
    );
  });
});

describe("catchUpWeight", () => {
  it("water_change outweighs fertilize at same delay", () => {
    expect(catchUpWeight("water_change", 2)).toBeGreaterThan(catchUpWeight("fertilize", 2));
  });
  it("older backlog weighs more", () => {
    expect(catchUpWeight("water_change", 5)).toBeGreaterThan(catchUpWeight("water_change", 1));
  });
});

describe("doneOn — the dashboard's \"done today\" group", () => {
  it("is false when the schedule was never done", () => {
    expect(doneOn(sched({ lastDoneAt: null }), "2026-08-28", TZ)).toBe(false);
  });

  it("is true on the local day of the completion", () => {
    expect(doneOn(sched({ lastDoneAt: "2026-08-28T09:15:00.000Z" }), "2026-08-28", TZ)).toBe(true);
  });

  it("is false for a completion on any other day", () => {
    const s = sched({ lastDoneAt: "2026-08-27T09:15:00.000Z" });
    expect(doneOn(s, "2026-08-28", TZ)).toBe(false);
    expect(doneOn(s, "2026-08-26", TZ)).toBe(false);
  });

  // bug hotspot #1: a UTC `iso.slice(0, 10)` would put both of these on the
  // wrong Berlin day, so a task closed late in the evening would vanish from
  // the queue instead of offering Undo
  it("counts 23:30 Berlin as that Berlin day, not the next UTC one", () => {
    // 2026-08-28T23:30 Berlin (CEST, +02:00) === 2026-08-28T21:30Z
    expect(doneOn(sched({ lastDoneAt: "2026-08-28T21:30:00.000Z" }), "2026-08-28", TZ)).toBe(true);
  });

  it("counts 00:30 Berlin as that Berlin day, not the previous UTC one", () => {
    // 2026-08-29T00:30 Berlin (CEST, +02:00) === 2026-08-28T22:30Z
    const s = sched({ lastDoneAt: "2026-08-28T22:30:00.000Z" });
    expect(doneOn(s, "2026-08-29", TZ)).toBe(true);
    expect(doneOn(s, "2026-08-28", TZ)).toBe(false);
  });

  it("holds across the DST transition (CET, +01:00)", () => {
    // 2026-01-15T00:30 Berlin === 2026-01-14T23:30Z
    const s = sched({ lastDoneAt: "2026-01-14T23:30:00.000Z" });
    expect(doneOn(s, "2026-01-15", TZ)).toBe(true);
    expect(doneOn(s, "2026-01-14", TZ)).toBe(false);
  });
});
