import { sqliteTable, text, integer, index, uniqueIndex, check } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { ACTION_TYPE_KEYS } from "@/lib/domain/action-types";

/**
 * issue: standard-events catalog (action-types.ts) is the single source of
 * truth for action_type — this CHECK is the last gate (zod at the API layer
 * is first) so raw SQL / a future MCP write can't slip a free-form type in.
 */
const ACTION_TYPE_LIST = sql.raw(ACTION_TYPE_KEYS.map((k) => `'${k}'`).join(","));

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
/** issue #42: food types kept at the tank (for the feed plan's structured details) */
export type Food = { name: string; amount: string; unit: string };
/**
 * issue #42: structured per-action details (replaces free-text for standard
 * types). Shape depends on actionType:
 * - water_change: { percent: number }
 * - fertilize:    { nutrients: Record<nutrientKey, string> } (dose per nutrient)
 * - feed:         { foods: Record<foodName, string> } (amount per food type)
 * - filter_change / water_test / others: {} (no structured details)
 */
export type DetailData = Record<string, unknown>;
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
  foods: text("foods", { mode: "json" }).$type<Food[]>().notNull().default(sql`'[]'`),
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
    // free-text concrete instructions (issue #30): "30 L of 60 L (50 %)", "10 ml iron fertilizer"
    details: text("details"),
    // issue #42: STRUCTURED details per standard action type (percent, nutrient doses) —
    // kept in sync with `details` as the human-readable rendering
    detailData: text("detail_data", { mode: "json" }).$type<DetailData>(),
    // optional end date (issue #31): bounded schedules — after this date the event
    // disappears from dashboard/calendar/ICS; history/logs stay untouched
    endsOn: text("ends_on"), // YYYY-MM-DD date-only string, compared lexically
    // incremented on every mutation → feeds ICS SEQUENCE together with missedSlots()
    scheduleVersion: integer("schedule_version").notNull().default(0),
    // Tight-gap policy after catch-up (issue #1): 'fixed' = keep grid, 'suppress' = skip
    // the first grid point when it lands < threshold% of intervalDays after the projection.
    // Nullable = "use defaults" (suppress @ 50%); UI treats null as default.
    tightGapPolicy: text("tight_gap_policy", { enum: ["fixed", "suppress"] }),
    tightGapThresholdPct: integer("tight_gap_threshold_pct"),
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
    // Data-integrity (issues #2/#3): reject degenerate values at the DB layer —
    // zod in Server Actions is the first line, this is the last (e.g. raw SQL, MCP).
    check("schedules_interval_positive", sql`${t.intervalDays} >= 1`),
    check("schedules_preferred_days_range", sql`${t.preferredDays} >= 1 AND ${t.preferredDays} <= 127`),
    check("schedules_tight_gap_pct_range", sql`${t.tightGapThresholdPct} IS NULL OR (${t.tightGapThresholdPct} >= 1 AND ${t.tightGapThresholdPct} <= 99)`),
    check("schedules_action_type_standard", sql`${t.actionType} IN (${ACTION_TYPE_LIST})`),
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
    // 'user' | 'ai_proposed' | 'mcp' | 'api' (never auto-written) — 'mcp' = done via the v1.1
    // MCP tools, 'api' = done via the v1 REST API (/api/v1) e.g. an ESPHome display
    source: text("source", { enum: ["user", "ai_proposed", "mcp", "api"] }).notNull().default("user"),
    // issue: standard-events catalog — the plan this log closed, if any (nullable:
    // a freestanding log, e.g. a backdated note, has no matching plan)
    // ON DELETE SET NULL: deleteScheduleCore hard-deletes schedules while
    // history stays intact (repo.ts) — a log that closed a since-deleted
    // plan keeps its details/detailData, it just loses the back-reference.
    scheduleId: integer("schedule_id").references(() => schedules.id, { onDelete: "set null" }),
    // same shape/rendering as schedules.details/detailData: a plan-closing log
    // inherits the plan's details unless the caller supplies its own (repo.ts)
    details: text("details"),
    detailData: text("detail_data", { mode: "json" }).$type<DetailData>(),
  },
  (t) => [
    index("idx_logs_tank").on(t.tankId),
    index("idx_logs_done").on(t.doneAt),
    check("logs_action_type_standard", sql`${t.actionType} IN (${ACTION_TYPE_LIST})`),
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

// Debug-only trace of raw provider payloads (Settings → More → Debug). Kept
// SEPARATE from aiCalls: aiCalls is an insert-only audit trail read for
// budget aggregates and must contain only counters/cost estimates (AGENTS.md
// AI data-boundary check); this table is pruned to the most recent N rows in
// logAiCall() since it exists purely to inspect the last few calls, not to
// keep history.
export const aiCallLogs = sqliteTable(
  "ai_call_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
    purpose: text("purpose").notNull(), // 'coach' | 'plan_review' | 'suggestions'
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    requestJson: text("request_json").notNull(),
    responseJson: text("response_json"), // null when the call errored before a response
    error: text("error"),
    durationMs: integer("duration_ms").notNull().default(0),
  },
  (t) => [index("idx_ai_call_logs_created").on(t.createdAt)],
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
export type AiCallLog = typeof aiCallLogs.$inferSelect;
