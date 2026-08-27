/**
 * MCP bearer token (TechDesign §4.6, product v1.1): the /api/mcp endpoint is
 * fully bearer-gated — the entire MCP surface exists only behind this token.
 *
 * - Stored in `appSettings` (key "mcpToken") so the Settings UI can show and
 *   rotate it, exactly like the ICS feed token.
 * - Comparison reuses `safeTokenEqual` from ics-token (SHA-256 both sides +
 *   timingSafeEqual): a raw compare throws RangeError on wrong-length tokens,
 *   which would turn a scanner probe into a 500 that leaks the token's length.
 */
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { appSettings } from "@/lib/db/schema";
import { safeTokenEqual } from "@/lib/ics-token";

const KEY = "mcpToken";

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
export function getOrCreateMcpToken(): string {
  const row = db.select().from(appSettings).where(eq(appSettings.key, KEY)).get();
  const v = row?.value as TokenValue | undefined;
  if (v?.token) return v.token;
  const token = generateToken();
  write(token);
  return token;
}

/** Generates a fresh token and persists it, invalidating the previous one. */
export function rotateMcpToken(): string {
  const token = generateToken();
  write(token);
  return token;
}

export { safeTokenEqual };
