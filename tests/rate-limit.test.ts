import { describe, it, expect, beforeEach } from "vitest";
import { isRateLimited, recordFailure, recordSuccess, MAX_FAILURES, __resetRateLimiter } from "../src/lib/rate-limit";

beforeEach(() => __resetRateLimiter());

describe("rate limiter (30 failed attempts/IP/hour → blocked)", () => {
  it("not limited before any failures", () => {
    expect(isRateLimited("1.2.3.4")).toBe(false);
  });

  it("blocks after MAX_FAILURES failures, not before", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < MAX_FAILURES - 1; i++) recordFailure("1.2.3.4", t0 + i);
    expect(isRateLimited("1.2.3.4", t0)).toBe(false);
    recordFailure("1.2.3.4", t0);
    expect(isRateLimited("1.2.3.4", t0)).toBe(true);
  });

  it("success clears the counter", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < MAX_FAILURES; i++) recordFailure("1.2.3.4", t0);
    expect(isRateLimited("1.2.3.4", t0)).toBe(true);
    recordSuccess("1.2.3.4");
    expect(isRateLimited("1.2.3.4", t0)).toBe(false);
  });

  it("window expires after an hour", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < MAX_FAILURES; i++) recordFailure("1.2.3.4", t0);
    expect(isRateLimited("1.2.3.4", t0)).toBe(true);
    const anHourLater = t0 + 60 * 60 * 1000 + 1;
    expect(isRateLimited("1.2.3.4", anHourLater)).toBe(false);
  });

  it("keys (IPs) are independent", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < MAX_FAILURES; i++) recordFailure("1.2.3.4", t0);
    expect(isRateLimited("1.2.3.4", t0)).toBe(true);
    expect(isRateLimited("5.6.7.8", t0)).toBe(false);
  });
});
