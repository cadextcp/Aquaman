/**
 * MCP tool implementations (product v1.1 — TechDesign §4.6).
 *
 * Plain, JSON-serializable functions — no SDK types in here — so the tools
 * are unit-testable without a transport and the McpServer wrapper in
 * server.ts stays a thin shell. All reads go through `src/lib/repo`, all
 * writes through the SAME cores the in-app Server Actions use (one
 * implementation, identical validation), and all range logic through
 * `src/lib/domain/*`.
 *
 * Data boundary: never expose photoPath (a server-side filesystem path —
 * tech_stack.md "never send server paths") or any settings/tokens.
 */
import {
  listTanks,
  listProducts,
  listSchedules,
  waterTestsForTank,
  markScheduleDoneCore,
  snoozeScheduleCore,
  logWaterTestCore,
} from "@/lib/repo";
import { nextDue, missedSlots, catchUpWeight, MISSED_SLOTS_HINT } from "@/lib/domain/scheduler";
import { evaluateWaterTest, FRESHWATER_RANGES, SALTWATER_RANGES } from "@/lib/domain/ranges";
import { waterTestInputSchema } from "@/lib/schemas";
import { z } from "zod";

export type ToolPayload = Record<string, unknown>;
export type ToolOutcome = { ok: true; payload: ToolPayload } | { ok: false; error: string };

const MAX_WATER_DAYS = 365;
const DEFAULT_WATER_DAYS = 90;

function tanksWithRanges() {
  return listTanks().map((t) => ({
    id: t.id,
    name: t.name,
    volumeL: t.volumeL,
    waterType: t.waterType,
    plants: t.plants,
    fish: t.fish,
    equipment: { co2: t.hasCo2, heater: t.hasHeater, filter: t.hasFilter, filterType: t.filterType },
    tankState: t.tankState,
  }));
}

export function getTanks(): ToolOutcome {
  return { ok: true, payload: { tanks: tanksWithRanges() } };
}

/**
 * The inventory, read-only. There is deliberately no write counterpart: the
 * MCP surface stays read-heavy (code_patterns.md), and a shelf is something
 * the user curates in the app, not something an agent should be editing.
 */
export function getProducts(input: unknown): ToolOutcome {
  const parsed = z.object({ kind: z.enum(["fertilizer", "food"]).optional() }).safeParse(input ?? {});
  if (!parsed.success) return { ok: false, error: "Invalid arguments" };
  return {
    ok: true,
    payload: {
      products: listProducts(parsed.data.kind).map((p) => ({
        id: p.id,
        kind: p.kind,
        name: p.name,
        description: p.description,
        nutrients: p.nutrients,
        defaultDose: p.defaultDose,
      })),
    },
  };
}

export function getWaterValues(input: unknown): ToolOutcome {
  const parsed = z
    .object({ tankId: z.number().int().positive().optional(), days: z.number().int().min(1).max(MAX_WATER_DAYS).optional() })
    .safeParse(input ?? {});
  if (!parsed.success) return { ok: false, error: "Invalid arguments: tankId (positive int) and days (1-365) are optional" };
  const days = parsed.data.days ?? DEFAULT_WATER_DAYS;
  const tanks = parsed.data.tankId
    ? tanksWithRanges().filter((t) => t.id === parsed.data.tankId)
    : tanksWithRanges();
  if (parsed.data.tankId && tanks.length === 0) return { ok: false, error: "Tank not found" };

  const result = tanks.map((t) => {
    const tests = waterTestsForTank(t.id, days);
    const latest = tests[0];
    // the latest test is also the one that gets the NH3 (from NH4+pH+temp) verdict
    const evaluation = latest
      ? evaluateWaterTest(latest.values, t.waterType === "salt" ? SALTWATER_RANGES : FRESHWATER_RANGES, {
          ph: latest.values["ph"],
          temp: latest.values["temp"],
          tankState: t.tankState,
        })
      : [];
    return { tank: { id: t.id, name: t.name, waterType: t.waterType, tankState: t.tankState }, days, testCount: tests.length, latestTest: latest ?? null, evaluation };
  });
  return { ok: true, payload: { tanks: result } };
}

export function getPendingMaintenance(input: unknown): ToolOutcome {
  const parsed = z.object({ tankId: z.number().int().positive().optional() }).safeParse(input ?? {});
  if (!parsed.success) return { ok: false, error: "Invalid arguments: tankId (positive int) is optional" };
  const schedules = listSchedules(parsed.data.tankId);
  const tasks = schedules
    .map((s) => {
      const due = nextDue(s);
      const missed = missedSlots(s);
      return {
        scheduleId: s.id,
        tankId: s.tankId,
        tankName: s.tankName,
        actionType: s.actionType,
        details: s.details,
        originalDueAt: due.originalDueAt,
        plannedFor: due.plannedFor,
        overdueDays: due.overdueDays,
        missedSlots: missed,
        tightGapHint: missed >= MISSED_SLOTS_HINT ? "interval too tight? consider a longer interval" : null,
        catchUpWeight: catchUpWeight(s.actionType, due.overdueDays),
      };
    })
    .sort((a, b) => a.plannedFor.localeCompare(b.plannedFor) || b.catchUpWeight - a.catchUpWeight);
  return { ok: true, payload: { tasks, count: tasks.length } };
}

export function addWaterTest(input: unknown): ToolOutcome {
  const res = logWaterTestCore(input);
  if (!res.ok) return { ok: false, error: res.error };
  const saved = waterTestInputSchema.parse(input); // already validated by the core
  return { ok: true, payload: { tankId: res.tankId, saved: saved.values } };
}

export function logMaintenance(input: unknown): ToolOutcome {
  const parsed = z
    .object({ scheduleId: z.number().int().positive(), note: z.string().trim().max(500).optional() })
    .safeParse(input ?? {});
  if (!parsed.success) return { ok: false, error: "Invalid arguments: scheduleId (positive int) required, note optional" };
  // source 'mcp' keeps remote completions distinguishable in maintenance history
  const res = markScheduleDoneCore(parsed.data.scheduleId, parsed.data.note, "mcp");
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, payload: { scheduleId: parsed.data.scheduleId, tankId: res.tankId, markedDone: true } };
}

export function snoozeTask(input: unknown): ToolOutcome {
  const parsed = z
    .object({ scheduleId: z.number().int().positive(), until: z.string().date() })
    .safeParse(input ?? {});
  if (!parsed.success) return { ok: false, error: "Invalid arguments: scheduleId (positive int) and until (YYYY-MM-DD) required" };
  const res = snoozeScheduleCore(parsed.data.scheduleId, parsed.data.until);
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, payload: { scheduleId: parsed.data.scheduleId, tankId: res.tankId, snoozedUntil: parsed.data.until } };
}

export async function askCoach(input: unknown): Promise<ToolOutcome> {
  const parsed = z.object({ question: z.string().trim().min(1).max(2000) }).safeParse(input ?? {});
  if (!parsed.success) return { ok: false, error: "Invalid arguments: question (1-2000 chars) required" };
  const question = parsed.data.question;

  const { getAiConfig } = await import("@/lib/ai/config");
  const { checkBudget, reserveCallSlot, releaseCallSlot, recordAiCall } = await import("@/lib/ai/cost-guard");
  const { buildCoachContext, COACH_SYSTEM_PROMPT } = await import("@/lib/ai/context");
  const { streamCoachAnswer } = await import("@/lib/ai/client");

  const config = getAiConfig();
  if (!config) {
    return { ok: false, error: "AI is not configured — set AQUAMAN_AI_API_KEY to enable the coach. Core features are fully working without it." };
  }
  // Same two-tier daily ceiling as the in-app coach (calls AND tokens) —
  // MCP must never be a way around the budget.
  const verdict = checkBudget(config);
  if (!verdict.allowed) {
    return { ok: false, error: verdict.reason === "calls"
      ? `AI paused — daily call limit reached (${config.maxCallsPerDay}/day). Resets at local midnight.`
      : `AI paused — daily token limit reached (${config.maxTokensPerDay}/day). Resets at local midnight.` };
  }
  const reservation = reserveCallSlot(config);
  if (!reservation.ok) {
    return { ok: false, error: `AI paused — daily call limit reached (${config.maxCallsPerDay}/day). Resets at local midnight.` };
  }

  try {
    // Holder object (not `let` locals): usage/failure are assigned inside the
    // stream callback, and TS flow analysis narrows callback-mutated `let`s
    // to `never` at the read site.
    const state: {
      answer: string;
      usage: { promptTokens: number; completionTokens: number } | null;
      failure: string | null;
    } = { answer: "", usage: null, failure: null };
    await streamCoachAnswer({
      system: `${COACH_SYSTEM_PROMPT}\n\n=== USER DATA CONTEXT ===\n${buildCoachContext()}`,
      question,
      history: [],
      onEvent: (ev) => {
        if (ev.type === "text") state.answer += ev.delta;
        else if (ev.type === "done") state.usage = ev.usage;
        else if (ev.type === "error") state.failure = ev.message;
        // proposals are deliberately IGNORED here: approval happens in the app,
        // an MCP answer must never look like it can change the plan remotely
      },
    });
    if (state.usage) {
      const { providerLabel, estimateCostMicros } = await import("@/lib/ai/config");
      recordAiCall({
        provider: providerLabel(config.baseUrl),
        model: config.model,
        purpose: "coach",
        promptTokens: state.usage.promptTokens,
        completionTokens: state.usage.completionTokens,
        costEstimateMicros: estimateCostMicros(config.model, state.usage.promptTokens, state.usage.completionTokens),
      });
    }
    if (state.failure) return { ok: false, error: state.failure };
    return { ok: true, payload: { answer: state.answer.trim() || "(no answer)" } };
  } catch (err) {
    console.error("[mcp askCoach]", err);
    return { ok: false, error: "AI is unreachable — core features are fully working without it." };
  } finally {
    releaseCallSlot(reservation.day);
  }
}
