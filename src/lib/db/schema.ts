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
/**
 * Fertilizer nutrient content: nutrient key (from NUTRIENTS in
 * domain/plan-structure.ts) → declared content as free text ("0.2 %", "7 g/l").
 * An empty string means "contained, no content declared" — the KEY is what the
 * plan comparison uses, the text is extra information for the coach.
 *
 * Deliberately the same shape as a fertilize plan's detailData.nutrients
 * (dose per nutrient), so comparing plan against stock is a key comparison
 * and needs no mapping layer.
 */
export type ProductNutrients = Record<string, string>;
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
  // NOTE: `foods` lived here until migration 0007 — food is a PRODUCT now
  // (see `products` below), pooled for the whole install instead of typed in
  // again per tank.
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
  // Free-form feeding plan (docs/plan-fuetterungsplan.md): the owner's own
  // markdown — which food on which days, amounts, fasting days. Deliberately
  // NOT a schedule: feeding is a daily counter (feed_logs), and this text is
  // context for humans and the coach, never a plan that ticks anything off.
  feedingPlan: text("feeding_plan"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  deletedAt: text("deleted_at"),
});

/**
 * Product inventory (docs/plan-produkt-lager.md): the fertilizers and foods
 * the user actually owns. Install-global on purpose — a shelf stands in the
 * cupboard, not in a tank.
 *
 * Replaces the former per-tank `tanks.foods` (migration 0007). A feed plan's
 * detailData is keyed by the food NAME, and the migration carries the names
 * over unchanged, so existing plans keep rendering.
 */
export const products = sqliteTable(
  "products",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kind: text("kind", { enum: ["fertilizer", "food"] }).notNull(),
    name: text("name").notNull(),
    // The field the coach reads: dosing instructions off the label, which fish
    // a food suits, anything worth knowing when recommending it.
    description: text("description"),
    // Only ever filled for kind='fertilizer'; keys come exclusively from
    // NUTRIENTS (domain/plan-structure.ts).
    nutrients: text("nutrients", { mode: "json" }).$type<ProductNutrients>().notNull().default(sql`'{}'`),
    // Replaces the old Food.amount + Food.unit: the suggested dose, used as
    // the placeholder in a plan's structured-details editor.
    defaultDose: text("default_dose"),
    // Where an imported entry came from (docs/plan-produkt-import-url.md §8).
    // NULL for everything typed by hand, and that absence is the information:
    // a source line says these numbers were transcribed off that page on that
    // day, so a year later nobody has to wonder whether the analysis came from
    // the tin or from a shop that has since changed the recipe.
    sourceUrl: text("source_url"),
    sourceFetchedAt: text("source_fetched_at"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
    // Soft-delete like everything else here: plans and logs reference a
    // product by name, so a row must never actually vanish.
    deletedAt: text("deleted_at"),
  },
  (t) => [
    index("idx_products_kind").on(t.kind),
    // Partial unique index: a second "JBL NovoBel" among the foods is a typo,
    // not another product. Restricted to live rows so a deleted name can be
    // reused.
    uniqueIndex("uq_products_kind_name").on(t.kind, t.name).where(sql`${t.deletedAt} IS NULL`),
    check("products_kind_valid", sql`${t.kind} IN ('fertilizer','food')`),
  ],
);

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
export type Product = typeof products.$inferSelect;
export type Schedule = typeof schedules.$inferSelect;
export type MaintenanceLog = typeof maintenanceLogs.$inferSelect;
export type WaterTest = typeof waterTests.$inferSelect;
export type FeedLog = typeof feedLogs.$inferSelect;
export type AiCallLog = typeof aiCallLogs.$inferSelect;
