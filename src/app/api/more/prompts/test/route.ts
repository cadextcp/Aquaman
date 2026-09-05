/**
 * POST /api/more/prompts/test — the "test" button of the prompt editor
 * (docs/plan-prompt-anpassung.md §5).
 *
 * Runs an — possibly unsaved — prompt through the real provider once and
 * returns the result as inert data. This route NEVER writes: no chip cache,
 * no plan-review banner, no editor fill, and the payload carries no path
 * into applyProposal. The engine's contract (lib/ai/prompt-test.ts) is the
 * documentation of that guarantee.
 *
 * Real call, real cost: purpose 'prompt_test', inside the shared daily AI
 * budget, plus its own per-IP rate limit — a test button must not become a
 * free spigot.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runPromptTest } from "@/lib/ai/prompt-test";
import { PROMPT_MAX_CHARS, validatePromptText } from "@/lib/ai/prompts";
import { hitLimit } from "@/lib/rate-limit";
import type { ErrorCode } from "@/lib/domain/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TESTS_PER_HOUR = 10;

const bodySchema = z
  .object({
    promptId: z.enum(["coach", "suggestions", "planReview", "feedingPlanDraft"]),
    system: z.string().min(1).max(PROMPT_MAX_CHARS + 100),
    // Required for the chat prompt; the tool-based prompts bring their own user turn.
    question: z.string().max(2000).optional(),
  })
  .refine((b) => b.promptId !== "coach" || (b.question?.trim() ?? "") !== "", {
    message: "question is required to test the coach prompt",
  });

function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

function failure(code: ErrorCode, status: number, error: string) {
  return NextResponse.json({ ok: false, error, code }, { status });
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  if (hitLimit(`promptTest:${ip}`, MAX_TESTS_PER_HOUR)) {
    return failure("prompt.rateLimited", 429, "Too many prompt tests, try again later");
  }

  const parsedBody = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsedBody.success) {
    return failure("prompt.invalid", 400, "promptId and system are required (question too, for the coach prompt)");
  }

  // The SAME validation saving uses, here so the editor's error text carries
  // the actual reason (unknown placeholder, missing {{context}}, …).
  const check = validatePromptText(parsedBody.data.promptId, parsedBody.data.system);
  if (!check.ok) {
    return NextResponse.json(
      { ok: false, error: check.error, code: "prompt.invalid", vars: { detail: check.error } },
      { status: 422 },
    );
  }

  const result = await runPromptTest(parsedBody.data);

  if (!result.ok) {
    const status =
      result.code === "prompt.limitReached" || result.code === "prompt.rateLimited"
        ? 429
        : result.code === "prompt.aiOffline"
          ? 503
          : 422;
    return failure(result.code, status, `Prompt test refused (${result.code})`);
  }

  return NextResponse.json(result);
}
