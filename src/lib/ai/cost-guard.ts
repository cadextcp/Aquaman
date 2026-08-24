/**
 * Two-tier AI cost guard (TechDesign §4.5, §8 — plan review R7).
 *
 * Limits: AQUAMAN_AI_MAX_CALLS_PER_DAY (default 20) AND
 * AQUAMAN_AI_MAX_TOKENS_PER_DAY (default 200k). Both are enforced; whichever
 * trips first pauses the AI until local midnight (AQUAMAN_TIMEZONE). There is
 * no cron — the reset happens on-demand when the next call checks the day.
 *
 * Telemetry rows in aiCalls are INSERT-only (audit trail); the guard reads
 * aggregates over today's rows, so recording a call can never lower today's
 * usage but immediately reflects the finished call.
 */

import { eq, count, sum } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiCalls } from "@/lib/db/schema";
import { today } from "@/lib/domain/dates";
import type { AiConfig } from "./config";

export type UsageSnapshot = {
  day: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  maxCalls: number;
  maxTokens: number;
};

export type GuardVerdict =
  | { allowed: true; usage: UsageSnapshot }
  | { allowed: false; reason: "calls" | "tokens"; usage: UsageSnapshot };

/** Local calendar day (AQUAMAN_TIMEZONE) — the reset boundary. */
export function usageDay(now: Date = new Date(), tz?: string): string {
  return today(tz, now);
}

/** Today's usage across ALL purposes (coach, proposals, …) — one aggregate. */
export function getUsage(config: AiConfig, now: Date = new Date()): UsageSnapshot {
  const day = usageDay(now);
  const row = db
    .select({
      calls: count(aiCalls.id),
      promptTokens: sum(aiCalls.promptTokens),
      completionTokens: sum(aiCalls.completionTokens),
    })
    .from(aiCalls)
    .where(eq(aiCalls.day, day))
    .get();
  const calls = Number(row?.calls ?? 0); // count() is 0 (not NULL) on empty sets
  const promptTokens = Number(row?.promptTokens ?? 0);
  const completionTokens = Number(row?.completionTokens ?? 0);
  return {
    day,
    calls,
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    maxCalls: config.maxCallsPerDay,
    maxTokens: config.maxTokensPerDay,
  };
}

/**
 * Pre-call check. Call this BEFORE talking to the provider; if not allowed,
 * the coach shows "AI paused (daily limit)" — core features unaffected.
 */
export function checkBudget(config: AiConfig, now: Date = new Date()): GuardVerdict {
  const usage = getUsage(config, now);
  if (usage.calls >= config.maxCallsPerDay) return { allowed: false, reason: "calls", usage };
  if (usage.totalTokens >= config.maxTokensPerDay) return { allowed: false, reason: "tokens", usage };
  return { allowed: true, usage };
}

/**
 * Record a finished call. `usage` MUST come from the final streaming event —
 * reading it anywhere else counts zero tokens (AGENTS streaming gotcha).
 */
export function recordAiCall(params: {
  provider: string;
  model: string;
  purpose: string;
  promptTokens: number;
  completionTokens: number;
  costEstimateMicros: number;
  now?: Date;
}): void {
  const day = usageDay(params.now ?? new Date());
  db.insert(aiCalls).values({
    day,
    provider: params.provider,
    model: params.model,
    promptTokens: Math.max(0, Math.round(params.promptTokens)),
    completionTokens: Math.max(0, Math.round(params.completionTokens)),
    costEstimateMicros: Math.max(0, Math.round(params.costEstimateMicros)),
    purpose: params.purpose,
  }).run();
}

/** Usage visible in Settings — works without config (no limits shown). */
export function usageForSettings(now: Date = new Date()): {
  day: string;
  calls: number;
  totalTokens: number;
} {
  const day = usageDay(now);
  const row = db
    .select({
      calls: count(aiCalls.id),
      promptTokens: sum(aiCalls.promptTokens),
      completionTokens: sum(aiCalls.completionTokens),
    })
    .from(aiCalls)
    .where(eq(aiCalls.day, day))
    .get();
  const promptTokens = Number(row?.promptTokens ?? 0);
  const completionTokens = Number(row?.completionTokens ?? 0);
  return {
    day,
    calls: Number(row?.calls ?? 0),
    totalTokens: promptTokens + completionTokens,
  };
}
