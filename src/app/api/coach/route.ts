/**
 * POST /api/coach — NDJSON streaming endpoint (Phase 4 — TechDesign §4.5).
 *
 * Not token-gated: the app has no auth, so the coach route sits behind the
 * same reverse proxy as every other page (documented in README). It is
 * POST-only, input-capped, and guarded by the shared failure-only rate
 * limiter so it cannot become an open AI-cost spigot.
 *
 * Request:  { question: string, history?: [{role, content}] }
 * Response: NDJSON lines (one JSON object per line, in order):
 *   {"type":"usage",  calls, totalTokens, maxCalls, maxTokens}
 *   {"type":"text",   delta}
 *   {"type":"proposal", proposal}
 *   {"type":"done",   usage:{promptTokens,completionTokens}}
 *   {"type":"error",  message}
 * The first line is ALWAYS usage (counters render before any text arrives).
 * "done" is only sent when the provider call accounted tokens in aiCalls.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAiConfig, providerLabel, estimateCostMicros } from "@/lib/ai/config";
import { checkBudget, recordAiCall } from "@/lib/ai/cost-guard";
import { buildCoachContext, COACH_SYSTEM_PROMPT } from "@/lib/ai/context";
import { streamCoachAnswer, type CoachMessage } from "@/lib/ai/client";
import { isRateLimited, recordFailure, recordSuccess } from "@/lib/rate-limit";
import { today } from "@/lib/domain/dates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_QUESTION_CHARS = 2000;
const MAX_HISTORY_MESSAGES = 12;
const MAX_MESSAGE_CHARS = 4000;

function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

function badRequest(msg: string): NextResponse {
  return NextResponse.json({ error: msg }, { status: 400 });
}

function parseHistory(raw: unknown): CoachMessage[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > MAX_HISTORY_MESSAGES) return null;
  const clean: CoachMessage[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") return null;
    const role = (m as { role?: unknown }).role;
    const content = (m as { content?: unknown }).content;
    if (role !== "user" && role !== "assistant") return null;
    if (typeof content !== "string" || content.length === 0 || content.length > MAX_MESSAGE_CHARS) return null;
    clean.push({ role, content });
  }
  return clean;
}

export async function POST(req: NextRequest): Promise<NextResponse | Response> {
  const ip = clientIp(req);
  // Failure-only limiter: a normal chat never accumulates; garbage floods do.
  if (isRateLimited(`coach:${ip}`)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  // ---- input guards ----
  let body: { question?: unknown; history?: unknown };
  try {
    body = await req.json();
  } catch {
    recordFailure(`coach:${ip}`);
    return badRequest("Invalid JSON body");
  }

  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) {
    recordFailure(`coach:${ip}`);
    return badRequest("question is required");
  }
  if (question.length > MAX_QUESTION_CHARS) {
    recordFailure(`coach:${ip}`);
    return badRequest(`question too long (max ${MAX_QUESTION_CHARS} chars)`);
  }

  const history = parseHistory(body.history);
  if (history === null) {
    recordFailure(`coach:${ip}`);
    return badRequest("invalid history");
  }

  // ---- AI guards ----
  const config = getAiConfig();
  if (!config) {
    return NextResponse.json(
      {
        error:
          "AI is not configured — set AQUAMAN_AI_API_KEY to enable the coach. Core features are fully working without it.",
      },
      { status: 503 },
    );
  }

  const verdict = checkBudget(config);
  if (!verdict.allowed) {
    return NextResponse.json(
      {
        error:
          verdict.reason === "calls"
            ? `AI paused — daily call limit reached (${config.maxCallsPerDay}/day). Resets at local midnight.`
            : `AI paused — daily token limit reached (${config.maxTokensPerDay}/day). Resets at local midnight.`,
      },
      { status: 429 },
    );
  }

  recordSuccess(`coach:${ip}`); // well-formed request clears the failure counter

  // ---- stream ----
  const context = buildCoachContext();
  const system = `${COACH_SYSTEM_PROMPT}\n\n=== USER DATA CONTEXT ===\n${context}`;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
      let recorded = false;
      try {
        send({
          type: "usage",
          day: verdict.usage.day,
          calls: verdict.usage.calls,
          totalTokens: verdict.usage.totalTokens,
          maxCalls: config.maxCallsPerDay,
          maxTokens: config.maxTokensPerDay,
        });

        await streamCoachAnswer({
          system,
          question,
          history,
          signal: req.signal,
          onEvent: (ev) => {
            if (ev.type === "done") {
              // Record the finished call NOW (insert-only telemetry) and emit
              // done afterwards — exactly once, only when usage is known.
              if (!recorded) {
                recorded = true;
                try {
                  recordAiCall({
                    provider: providerLabel(config.baseUrl),
                    model: config.model,
                    purpose: "coach",
                    promptTokens: ev.usage.promptTokens,
                    completionTokens: ev.usage.completionTokens,
                    costEstimateMicros: estimateCostMicros(config.model, ev.usage.promptTokens, ev.usage.completionTokens),
                  });
                } catch (err) {
                  console.error("[coach] recordAiCall failed", err);
                }
              }
              send({ type: "done", usage: ev.usage });
              return;
            }
            send(ev);
          },
        });
      } catch (err) {
        console.error("[coach] stream failed", err);
        send({ type: "error", message: "AI is unreachable — core features are fully working without it." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      "x-aquaman-today": today(),
    },
  });
}
