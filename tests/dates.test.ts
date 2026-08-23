import { describe, it, expect } from "vitest";
import {
  localDateStr,
  startOfLocalDay,
  localWeekdayIndex,
  addDays,
  weekdayOf,
  today,
  dayMatchesMask,
} from "../src/lib/domain/dates";

const TZ = "Europe/Berlin";

describe("localDateStr", () => {
  it("23:30 Berlin is still the same day", () => {
    // 2026-08-23 23:30 Berlin = 21:30 UTC
    expect(localDateStr(new Date("2026-08-23T21:30:00Z"), TZ)).toBe("2026-08-23");
  });
  it("00:30 Berlin is the NEXT day relative to UTC", () => {
    // 2026-08-24 00:30 Berlin = 2026-08-23 22:30 UTC
    expect(localDateStr(new Date("2026-08-23T22:30:00Z"), TZ)).toBe("2026-08-24");
  });
});

describe("localWeekdayIndex (Mon=0 … Sun=6)", () => {
  it("Monday morning Berlin = 0", () => {
    // 2026-08-24 is a Monday; 05:00 Berlin = 03:00 UTC
    expect(localWeekdayIndex(new Date("2026-08-24T03:00:00Z"), TZ)).toBe(0);
  });
  it("Sunday evening Berlin = 6", () => {
    // 2026-08-23 is a Sunday; 20:00 Berlin = 18:00 UTC
    expect(localWeekdayIndex(new Date("2026-08-23T18:00:00Z"), TZ)).toBe(6);
  });
  it("Sunday 23:30 Berlin (21:30 UTC) still Sunday = 6", () => {
    expect(localWeekdayIndex(new Date("2026-08-23T21:30:00Z"), TZ)).toBe(6);
  });
});

describe("startOfLocalDay", () => {
  it("returns midnight Berlin as UTC instant 22:00 previous day (CEST)", () => {
    // Midnight 2026-08-24 Berlin (CEST, +2) = 2026-08-23T22:00:00Z
    const start = startOfLocalDay(new Date("2026-08-24T10:00:00Z"), TZ);
    expect(start.toISOString()).toBe("2026-08-23T22:00:00.000Z");
  });
  it("DST transition: midnight after fall-back is 23:00Z previous day (CET)", () => {
    // DST ends 2026-10-25 in EU → 2026-10-26 midnight Berlin = 2026-10-25T23:00Z (CET, +1)
    const start = startOfLocalDay(new Date("2026-10-26T12:00:00Z"), TZ);
    expect(start.toISOString()).toBe("2026-10-25T23:00:00.000Z");
  });
});

describe("addDays / weekdayOf", () => {
  it("addDays crosses month boundary", () => {
    expect(addDays("2026-08-30", 3)).toBe("2026-09-02");
  });
  it("addDays handles negative", () => {
    expect(addDays("2026-09-01", -1)).toBe("2026-08-31");
  });
  it("weekdayOf: Monday = 0, Sunday = 6", () => {
    expect(weekdayOf("2026-08-24")).toBe(0); // Monday
    expect(weekdayOf("2026-08-23")).toBe(6); // Sunday
  });
});

describe("dayMatchesMask (bit 0 = Mon … bit 6 = Sun)", () => {
  it("weekend mask 0b1100000 (Sat=5, Sun=6) matches Sat+Sun only", () => {
    const mask = 0b1100000;
    expect(dayMatchesMask("2026-08-22", mask)).toBe(true); // Sat
    expect(dayMatchesMask("2026-08-23", mask)).toBe(true); // Sun
    expect(dayMatchesMask("2026-08-24", mask)).toBe(false); // Mon
  });
  it("full mask matches every day", () => {
    const mask = 0b1111111;
    expect(dayMatchesMask("2026-08-24", mask)).toBe(true);
    expect(dayMatchesMask("2026-08-28", mask)).toBe(true);
  });
});

describe("today", () => {
  it("uses app timezone, not server timezone", () => {
    // 2026-08-23 22:30 UTC = 2026-08-24 00:30 Berlin → today is the 24th
    expect(today(TZ, new Date("2026-08-23T22:30:00Z"))).toBe("2026-08-24");
  });
});
