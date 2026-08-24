/**
 * In-memory fixed-window rate limiter for token-gated public endpoints
 * (TechDesign v1.2 §8b: 30 failed attempts/IP/hour → 429).
 *
 * Single-instance, single-process only — acceptable for v1 (one container,
 * no horizontal scaling). Resets on process restart; that's fine, a fresh
 * boot is not an attack.
 */

const WINDOW_MS = 60 * 60 * 1000; // 1 hour
export const MAX_FAILURES = 30;

type Bucket = { count: number; windowStart: number };

const failuresByKey = new Map<string, Bucket>();

function freshWindow(bucket: Bucket | undefined, now: number): boolean {
  return !bucket || now - bucket.windowStart > WINDOW_MS;
}

export function isRateLimited(key: string, now: number = Date.now()): boolean {
  const bucket = failuresByKey.get(key);
  if (freshWindow(bucket, now)) return false;
  return bucket!.count >= MAX_FAILURES;
}

export function recordFailure(key: string, now: number = Date.now()): void {
  const bucket = failuresByKey.get(key);
  if (freshWindow(bucket, now)) {
    failuresByKey.set(key, { count: 1, windowStart: now });
  } else {
    bucket!.count++;
  }
}

/** Successful auth clears the counter — only FAILED attempts count toward the limit. */
export function recordSuccess(key: string): void {
  failuresByKey.delete(key);
}

/** Test-only: reset all state. */
export function __resetRateLimiter(): void {
  failuresByKey.clear();
}
