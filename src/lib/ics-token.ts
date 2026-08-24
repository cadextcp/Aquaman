/**
 * ICS feed token: generate/store/rotate/compare — TechDesign v1.2 §8b.
 *
 * - Stored in `appSettings` (key "icsToken") so Settings UI can show/rotate it.
 * - Compared via SHA-256(both sides) + timingSafeEqual (not a raw
 *   timingSafeEqual on the tokens themselves): the raw form throws
 *   RangeError when the two buffers differ in length, so a wrong-length
 *   token from a scanner would 500 instead of 404 (leaking the token's
 *   length in the process). Hashing first makes both sides fixed 32 bytes.
 */
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { appSettings } from "@/lib/db/schema";

const KEY = "icsToken";

type TokenValue = { token: string; createdAt: string };

function generateToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

function write(token: string): void {
  const value: TokenValue = { token, createdAt: new Date().toISOString() };
  db.insert(appSettings)
    .values({ key: KEY, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value } })
    .run();
}

/** Returns the current token, creating one on first use (fresh installs "just work"). */
export function getOrCreateIcsToken(): string {
  const row = db.select().from(appSettings).where(eq(appSettings.key, KEY)).get();
  const v = row?.value as TokenValue | undefined;
  if (v?.token) return v.token;
  const token = generateToken();
  write(token);
  return token;
}

/** Generates a fresh token and persists it, invalidating the previous one. */
export function rotateIcsToken(): string {
  const token = generateToken();
  write(token);
  return token;
}

/** Constant-time-ish compare: hash both sides first so length never leaks via a thrown error. */
export function safeTokenEqual(provided: string, expected: string): boolean {
  const a = crypto.createHash("sha256").update(provided).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}
