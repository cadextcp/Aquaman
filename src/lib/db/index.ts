import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import { mkdirSync } from "node:fs";
import path from "node:path";

/**
 * SQLite singleton — WAL mode for safe concurrent reads during dev hot reload.
 * NEVER open per-request connections (AGENTS.md gotcha).
 */

const DATA_DIR = process.env.AQUAMAN_DATA_DIR ?? path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "aquaman.db");

declare global {
  var __aquamanDb: ReturnType<typeof createDb> | undefined;
}

function createDb() {
  mkdirSync(DATA_DIR, { recursive: true });
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  return drizzle(sqlite, { schema });
}

export const db: ReturnType<typeof createDb> = globalThis.__aquamanDb ?? createDb();

if (process.env.NODE_ENV !== "production") {
  globalThis.__aquamanDb = db;
}

export { DB_PATH, DATA_DIR };
