/**
 * Integration tests for ICS token storage/rotation/compare (TechDesign §8b).
 * Runs against a throwaway SQLite file (own temp dir — Vitest isolates each
 * test file's module registry, so this doesn't collide with integration.test.ts).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";

const TMP = path.join("/tmp", `aquaman-ics-token-${Date.now()}`);
process.env.AQUAMAN_DATA_DIR = TMP;

beforeAll(async () => {
  mkdirSync(TMP, { recursive: true });
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const { db } = await import("../src/lib/db");
  migrate(db, { migrationsFolder: "./drizzle" });
});

afterAll(() => rmSync(TMP, { recursive: true, force: true }));

describe("getOrCreateIcsToken / rotateIcsToken / safeTokenEqual", () => {
  it("creates a token on first call and returns the SAME one afterward", async () => {
    const { getOrCreateIcsToken } = await import("../src/lib/ics-token");
    const a = getOrCreateIcsToken();
    const b = getOrCreateIcsToken();
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(20); // base64url of 24 random bytes
  });

  it("rotation invalidates the previous token", async () => {
    const { getOrCreateIcsToken, rotateIcsToken, safeTokenEqual } = await import("../src/lib/ics-token");
    const before = getOrCreateIcsToken();
    const after = rotateIcsToken();
    expect(after).not.toBe(before);
    expect(safeTokenEqual(before, getOrCreateIcsToken())).toBe(false);
    expect(safeTokenEqual(after, getOrCreateIcsToken())).toBe(true);
  });

  it("safeTokenEqual never throws on mismatched-length input (would leak length via 500)", async () => {
    const { safeTokenEqual } = await import("../src/lib/ics-token");
    expect(() => safeTokenEqual("short", "a-much-much-longer-token-value")).not.toThrow();
    expect(safeTokenEqual("short", "a-much-much-longer-token-value")).toBe(false);
    expect(safeTokenEqual("", "")).toBe(true);
  });

  it("safeTokenEqual is a real equality check, not always-false", async () => {
    const { safeTokenEqual } = await import("../src/lib/ics-token");
    expect(safeTokenEqual("same-token-value", "same-token-value")).toBe(true);
    expect(safeTokenEqual("same-token-value", "different-value")).toBe(false);
  });
});
