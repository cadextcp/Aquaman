/**
 * Anthropic-compatible streaming client (Phase 4 — TechDesign §4.5/§8).
 *
 * Official SDK with baseURL from env — one code path for api.anthropic.com
 * AND z.ai GLM. Streams text deltas + tool_use blocks.
 *
 * - tool_use inputs arrive as `input_json_delta` chunks → accumulated per
 *   content-block index, parsed + zod-validated on content_block_stop
 *   (malformed → rejected, never repaired)
 * - usage comes from the FINAL events (message_start = input tokens,
 *   message_delta = output tokens) — reading anywhere else counts zero
 *   (AGENTS streaming gotcha)
 * - consecutive same-role turns are merged: the API requires strict
 *   user/assistant alternation and a leading user turn
 * - `opts.signal` is forwarded to the provider call itself (RequestOptions.signal
 *   on client.messages.stream) — if the caller (route.ts, on client disconnect)
 *   aborts, the upstream request actually stops instead of running to
 *   completion for nobody and quietly spending the day's budget
 */

import Anthropic from "@anthropic-ai/sdk";
import { getAiConfig, providerLabel, REQUEST_TIMEOUT_MS, MAX_HISTORY_MESSAGES } from "./config";
import { parseProposal, PROPOSAL_TOOL_NAME, PROPOSAL_TOOL_DESCRIPTION, PROPOSAL_TOOL_INPUT_SCHEMA, type Proposal } from "./proposal";
import { logAiCall } from "./debug-log";

export type CoachMessage = { role: "user" | "assistant"; content: string };

export type CoachStreamEvent =
  | { type: "text"; delta: string }
  | { type: "proposal"; proposal: Proposal }
  | { type: "done"; usage: { promptTokens: number; completionTokens: number } }
  | { type: "error"; message: string };

/** Merge consecutive same-role turns; drop leading assistant turns. */
export function normalizeHistory(history: CoachMessage[], question: string): { role: "user" | "assistant"; content: string }[] {
  const merged: CoachMessage[] = [];
  for (const m of [...history, { role: "user" as const, content: question }]) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) {
      last.content = `${last.content}\n\n${m.content}`;
    } else {
      merged.push({ ...m });
    }
  }
  while (merged.length > 0 && merged[0].role === "assistant") merged.shift();
  return merged.slice(-MAX_HISTORY_MESSAGES); // hard cap on history cost
}

type ToolAcc = { name: string; json: string };

/**
 * Output budget per call. GLM (and other reasoning models) emit a "thinking"
 * section BEFORE the visible answer and bill it against max_tokens — at 1024
 * a real coach question often produced zero visible text (empty bubble,
 * output_tokens reported as exactly the cap). z.ai gets a higher ceiling as a
 * safety margin around that (on top of disabling thinking below); the default
 * (api.anthropic.com, which never had this bug) keeps the original budget —
 * quadrupling it there would only inflate cost/latency for no corresponding
 * problem.
 */
const MAX_OUTPUT_TOKENS_DEFAULT = 1024;
const MAX_OUTPUT_TOKENS_ZAI = 4096;

/** Steadier care advice and tool calls — no feature wants sampling variety. */
const TEMPERATURE = 0.3;

/**
 * Stream a coach answer. `onEvent` fires per event; provider failures surface
 * as { type: "error" } so the UI can degrade gracefully (fallback rule).
 */
export async function streamCoachAnswer(opts: {
  system: string;
  question: string;
  history: CoachMessage[];
  onEvent: (ev: CoachStreamEvent) => void;
  signal?: AbortSignal;
}): Promise<void> {
  const config = getAiConfig();
  if (!config) {
    opts.onEvent({ type: "error", message: "AI is not configured — core features are fully working without it." });
    return;
  }

  let client: Anthropic;
  try {
    client = new Anthropic({ apiKey: config.apiKey, baseURL: config.baseUrl, timeout: REQUEST_TIMEOUT_MS });
  } catch {
    opts.onEvent({ type: "error", message: "AI is not configured — core features are fully working without it." });
    return;
  }

  const usage = { promptTokens: 0, completionTokens: 0 };
  const tools: Record<number, ToolAcc> = {}; // content-block index → accumulator
  let fullText = "";
  let proposalOut: Proposal | null = null;
  const startedAt = Date.now();

  const isZai = providerLabel(config.baseUrl) === "zai";

  const requestBody = {
    model: config.model,
    max_tokens: isZai ? MAX_OUTPUT_TOKENS_ZAI : MAX_OUTPUT_TOKENS_DEFAULT,
    temperature: TEMPERATURE,
    // z.ai's GLM streams a "thinking" block by default and their
    // Anthropic-compat layer accepts turning it off (verified live:
    // zero thinking deltas, all tool fields present). api.anthropic.com
    // rejects that shape, so only send it on the z.ai path.
    ...(isZai ? { thinking: { type: "disabled" as const } } : {}),
    system: opts.system,
    messages: normalizeHistory(opts.history, opts.question),
    tools: [
      {
        name: PROPOSAL_TOOL_NAME,
        description: PROPOSAL_TOOL_DESCRIPTION,
        input_schema: { ...PROPOSAL_TOOL_INPUT_SCHEMA, type: "object" as const },
      },
    ],
  };

  try {
    const stream = client.messages.stream(
      requestBody,
      // forward the caller's abort signal — a disconnected client actually
      // stops the upstream call instead of burning budget for nobody
      { signal: opts.signal },
    );

    for await (const event of stream) {
      switch (event.type) {
        case "message_start":
          usage.promptTokens = event.message.usage?.input_tokens ?? 0;
          break;
        case "content_block_start":
          if (event.content_block.type === "tool_use") {
            tools[event.index] = { name: event.content_block.name, json: "" };
          }
          break;
        case "content_block_delta":
          if (event.delta.type === "text_delta") {
            fullText += event.delta.text;
            opts.onEvent({ type: "text", delta: event.delta.text });
          } else if (event.delta.type === "input_json_delta") {
            tools[event.index]!.json += event.delta.partial_json;
          }
          break;
        case "content_block_stop": {
          const acc = tools[event.index];
          if (acc && acc.name === PROPOSAL_TOOL_NAME) {
            let raw: unknown = null;
            try {
              raw = JSON.parse(acc.json || "{}");
            } catch {
              raw = null;
            }
            const parsed = parseProposal(raw);
            if (parsed) {
              proposalOut = parsed;
              opts.onEvent({ type: "proposal", proposal: parsed });
            } else {
              opts.onEvent({ type: "text", delta: "\n(I drafted a schedule proposal, but it failed validation — nothing was saved.)\n" });
            }
          }
          delete tools[event.index];
          break;
        }
        case "message_delta":
          if (event.usage?.output_tokens !== undefined) {
            usage.completionTokens = event.usage.output_tokens;
          }
          break;
        default:
          break;
      }
    }

    logAiCall({
      purpose: "coach",
      provider: providerLabel(config.baseUrl),
      model: config.model,
      request: requestBody,
      response: { text: fullText, proposal: proposalOut, usage },
      error: null,
      durationMs: Date.now() - startedAt,
    });

    opts.onEvent({ type: "done", usage: { promptTokens: usage.promptTokens, completionTokens: usage.completionTokens } });
  } catch (err) {
    // an aborted signal surfaces here too (SDK throws on cancellation) — no
    // one is listening by then, so onEvent below is a harmless no-op if the
    // caller's send() already guards against a closed stream (route.ts does)
    const message = friendlyError(err);
    logAiCall({
      purpose: "coach",
      provider: providerLabel(config.baseUrl),
      model: config.model,
      request: requestBody,
      response: fullText ? { text: fullText } : null,
      error: message,
      durationMs: Date.now() - startedAt,
    });
    opts.onEvent({ type: "error", message });
  }
}

function friendlyError(err: unknown): string {
  if (err instanceof Anthropic.APIError) {
    if (err.status === 401 || err.status === 403) return "AI rejected the credentials — check AQUAMAN_AI_API_KEY. Core features are fully working without it.";
    if (err.status === 429) return "AI provider rate limit reached — try again in a moment.";
    return `AI provider error (${err.status ?? "?"}) — core features are fully working without it.`;
  }
  if (err instanceof Error && err.name === "AbortError") return "AI request timed out — core features are fully working without it.";
  return "AI is unreachable — core features are fully working without it.";
}
