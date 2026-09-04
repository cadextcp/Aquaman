/**
 * Standard event catalog — the ONE list of action types the whole app agrees
 * on: schedulable plans, loggable history rows (UI, REST API, MCP, AI), and
 * catch-up priority all derive from this file instead of maintaining their
 * own divergent lists.
 *
 * `feed` is the one type that is neither `loggable` nor `schedulable` nor a
 * `standardPlan`: feeding is a DAILY HABIT counted in `feed_logs` (dashboard
 * stepper, one row per tank per local day), never a `maintenance_logs` row and
 * never a plan. Those three flags are what keep that promise — see the
 * "Feeding is a daily habit" gotcha in AGENTS.md for why a feed PLAN is
 * unsatisfiable by construction.
 *
 * Client-safe: no DB/Node imports, so UI components can import it directly.
 *
 * `detailKind` mirrors the structured `detailData` shapes documented in
 * db/schema.ts: undefined = no structured details (free text only).
 */

export type DetailKind = "percent" | "liters" | "nutrients" | "foods";

export type ActionTypeDef = {
  key: string;
  /** Human-readable label (dashboard, calendar, ICS). */
  label: string;
  /** Phosphor icon name (schedule-card rail). */
  icon: string;
  detailKind?: DetailKind;
  /** Whether the type can be logged via POST /api/v1/actions, MCP, Server Actions (feed cannot — it's a daily counter). */
  loggable: boolean;
  /**
   * Whether the type may appear on a care plan (`schedules` row). False for
   * `feed`: the feeding counter never writes `schedules.lastDoneAt`, so a feed
   * plan could never be satisfied — it would sit in the care queue accruing
   * backlog no matter how often you fed, and emit ICS events the PRD rules out.
   */
  schedulable: boolean;
  /**
   * "Standard plan" (issue #42): exactly one active plan per type per tank
   * (duplicate guard in repo.ts) + shows up in the tank page's "missing
   * plans" checklist. Distinct from detailKind — e.g. filter_change and
   * water_test are standard plans but have no structured details.
   */
  standardPlan: boolean;
  /** Base catch-up priority weight (higher = more urgent when overdue). */
  weight: number;
};

export const ACTION_TYPES: readonly ActionTypeDef[] = [
  { key: "water_change", label: "Water change", icon: "drop-half", detailKind: "percent", schedulable: true, loggable: true, standardPlan: true, weight: 100 },
  { key: "feed", label: "Feed", icon: "fish", detailKind: "foods", schedulable: false, loggable: false, standardPlan: false, weight: 90 },
  { key: "fertilize", label: "Fertilize", icon: "flask", detailKind: "nutrients", schedulable: true, loggable: true, standardPlan: true, weight: 60 },
  { key: "water_test", label: "Water test", icon: "eyedropper", schedulable: true, loggable: true, standardPlan: true, weight: 50 },
  { key: "substrate_vacuum", label: "Substrate vacuum", icon: "wind", schedulable: true, loggable: true, standardPlan: false, weight: 45 },
  { key: "filter_change", label: "Filter change", icon: "funnel", schedulable: true, loggable: true, standardPlan: true, weight: 40 },
  { key: "filter_clean", label: "Filter clean", icon: "funnel", schedulable: true, loggable: true, standardPlan: false, weight: 40 },
  { key: "water_top_up", label: "Water top up", icon: "drop", detailKind: "liters", schedulable: true, loggable: true, standardPlan: false, weight: 30 },
  { key: "glass_clean", label: "Glass clean", icon: "sparkle", schedulable: true, loggable: true, standardPlan: false, weight: 20 },
  { key: "plant_trim", label: "Plant trim", icon: "leaf", schedulable: true, loggable: true, standardPlan: false, weight: 20 },
] as const;

export type ActionType = (typeof ACTION_TYPES)[number]["key"];

export const ACTION_TYPE_KEYS: readonly ActionType[] = ACTION_TYPES.map((a) => a.key);

/** Types that may appear on a schedule — everything except `feed` (daily habit, see above). */
export const SCHEDULABLE_ACTION_TYPES: readonly ActionType[] = ACTION_TYPES.filter((a) => a.schedulable).map((a) => a.key);

/** Types that may be written via POST /api/v1/actions, MCP, or a manual log entry. `feed` is a daily counter (feed_logs), not a timestamped log row. */
export const LOGGABLE_ACTION_TYPES: readonly ActionType[] = ACTION_TYPES.filter((a) => a.loggable).map((a) => a.key);

const BY_KEY = new Map(ACTION_TYPES.map((a) => [a.key, a]));

export function isActionType(t: string): t is ActionType {
  return BY_KEY.has(t);
}

export function actionTypeDef(t: string): ActionTypeDef | undefined {
  return BY_KEY.get(t);
}

/**
 * "water_change" → "Water change" — catalog label, falling back to a
 * snake_case→Titlecase guess for safety.
 *
 * This is the MACHINE-facing English label. Anything a person reads goes
 * through i18n instead (`actionLabelFor` on the server, `useI18n().actionLabel`
 * in a client component), whose `action.*` catalog entries are keyed by the
 * same strings and are pinned to this list by tests/i18n.test.ts.
 */
export function actionLabel(t: string): string {
  const def = BY_KEY.get(t);
  if (def) return def.label;
  const s = t.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
