/**
 * Persisted AI API key (issue #40 follow-up: enter the key in /more instead
 * of only via env). Deliberately NOT in the SQLite DB (never touches
 * export/import) — a plain file in DATA_DIR, which is the same persisted
 * volume the DB lives in, so it survives container recreation unlike a
 * container-local .env. File contents are never returned to the client.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import path from "path";
import { DATA_DIR } from "@/lib/db";

const KEY_FILE = path.join(DATA_DIR, "ai-api-key");

export function readStoredApiKey(): string | null {
  try {
    const raw = readFileSync(KEY_FILE, "utf8").trim();
    return raw || null;
  } catch {
    return null; // file missing — fall back to env
  }
}

/** Pass an empty/whitespace-only string to clear the stored key. */
export function writeStoredApiKey(key: string): void {
  const trimmed = key.trim();
  if (!trimmed) {
    try {
      rmSync(KEY_FILE);
    } catch {
      // already absent
    }
    return;
  }
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(KEY_FILE, trimmed, { mode: 0o600 });
}

export function hasStoredApiKey(): boolean {
  return existsSync(KEY_FILE);
}
