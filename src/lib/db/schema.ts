import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/**
 * Aquaman schema — SQLite via Drizzle.
 *
 * Conventions (TechDesign v1.2 §4.2/§6):
 * - JSON fields are text({ mode: "json" }) — SQLite has no jsonb/array types
 * - Weekday preference is a 7-bit integer mask: Bit 0 = Mon … Bit 6 = Sun
 *   (use localWeekdayIndex() from domain/dates.ts — NEVER Date.getDay()
 *   directly, it returns 0 = Sunday)
 * - Soft-delete only (deletedAt/active), never row-delete
 * - All timestamps are ISO-8601 UTC strings (TEXT) for simplicity & ICS reuse
 */

export type Plant = { name: string; qty: number };
export type Fish = { species: string; qty: number };
export type WaterValues = Record<string, number | null>;
export type ParamOverrides = Record<string, { min?: number; max?: number; warnMin?: number; warnMax?: number }>;

export const tanks = sqliteTable("tanks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  volumeL: integer("volume_l").notNull(),
  waterType: text("water_type", { enum: ["fresh", "salt"] }).notNull().default("fresh"),
  photoPath: text("photo_path"),
  plants: text("plants", { mode: "json" }).$type<Plant[]>().notNull().default(sql`'[]'`),
  fish: text("fish", { mode: "json" }).$type<Fish[]>().notNull().default(sql`'[]'`),
  hasCo2: integer("has_co2", { mode: "boolean" }).notNull().default(false),
  hasHeater: integer("has_heater", { mode: "boolean" }).notNull().default(false),
  hasFilter: integer("has_filter", { mode: "boolean" }).notNull().default(true),
  filterType: text("filter_type"),
  // cycling = Einfahrphase (NO2/NH3 peaks are normal) vs established
  tankState: text("tank_state", { enum: ["cycling", "established"] }).notNull().default("established"),
  paramOverrides: text("param_overrides", { mode: "json" })
    .$type<ParamOverrides>()
    .notNull()
    .default(sql`'{}'`),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  deletedAt: text("deleted_at"),
});

export const schedules = sqliteTable(
  "schedules",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    tankId: integer("tank_id")
      .notNull()
      .references(() => tanks.id),
    actionType: text("action_type").notNull(), // 'water_change' | 'fertilize' | 'filter_change' | custom
    intervalDays: integer("interval_days").notNull(),
    // 7-bit mask: bit 0 = Mon … bit 6 = Sun. 0b1111111 (127) = every day.
    preferredDays: integer("preferred_days").notNull().default(127),
    autoReschedule: integer("auto_reschedule", { mode: "boolean" }).notNull().default(true),
    lastDoneAt: text("last_done_at"),
    snoozedUntil: text("snoozed_until"),
    snoozeSource: text("snooze_source", { enum: ["user"] }),
    // incremented on every mutation → feeds ICS SEQUENCE together with missedSlots()
    scheduleVersion: integer("schedule_version").notNull().default(0),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
  },
  (t) => [
    index("idx_schedules_tank").on(t.tankId),
    index("idx_schedules_active").on(t.active),
  ],
);

export const maintenanceLogs = sqliteTable(
  "maintenance_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    tankId: integer("tank_id")
      .notNull()
      .references(() => tanks.id),
    actionType: text("action_type").notNull(),
    doneAt: text("done_at").notNull(), // ISO-8601 UTC
    note: text("note"),
    // 'user' | 'ai_proposed' (never auto-written) — 'mcp' reserved for v1.1
    source: text("source", { enum: ["user", "ai_proposed"] }).notNull().default("user"),
  },
  (t) => [
    index("idx_logs_tank").on(t.tankId),
    index("idx_logs_done").on(t.doneAt),
  ],
);

export const waterTests = sqliteTable(
  "water_tests",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    tankId: integer("tank_id")
      .notNull()
      .references(() => tanks.id),
    measuredAt: text("measured_at").notNull(), // ISO-8601 UTC
    values: text("values", { mode: "json" }).$type<WaterValues>().notNull(),
    note: text("note"),
  },
  (t) => [index("idx_tests_tank").on(t.tankId), index("idx_tests_measured").on(t.measuredAt)],
);

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).$type<unknown>().notNull(),
});

// provider + model kept: telemetry should explain WHICH configured path was used
export const aiCalls = sqliteTable(
  "ai_calls",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    // local calendar day in AQUAMAN_TIMEZONE, format YYYY-MM-DD
    day: text("day").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    costEstimateMicros: integer("cost_estimate_micros").notNull().default(0),
    purpose: text("purpose").notNull(), // 'coach' | 'propose_schedule' | …
  },
  (t) => [index("idx_ai_day").on(t.day)],
);

export const feedLogs = sqliteTable(
  "feed_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    tankId: integer("tank_id")
      .notNull()
      .references(() => tanks.id),
    day: text("day").notNull(), // local day YYYY-MM-DD (AQUAMAN_TIMEZONE)
    fedAt: text("fed_at").notNull(), // ISO-8601 UTC
    timesFed: integer("times_fed").notNull().default(1),
  },
  (t) => [uniqueIndex("uq_feed_day").on(t.tankId, t.day)],
);

export type Tank = typeof tanks.$inferSelect;
export type Schedule = typeof schedules.$inferSelect;
export type MaintenanceLog = typeof maintenanceLogs.$inferSelect;
export type WaterTest = typeof waterTests.$inferSelect;
export type FeedLog = typeof feedLogs.$inferSelect;
