/**
 * POST /api/inventory/import — draft a NEW inventory product from a product
 * page or from pasted label text (docs/plan-produkt-import-url.md §3).
 *
 * Request:  { kind: "fertilizer" | "food", url?: string, text?: string }
 * Response: { ok: true, draft, notes, sourceUrl? } | { ok: false, error, code }
 *
 * This route NEVER writes. It returns a draft the client puts into the form
 * fields; the person then presses Save, which goes through the ordinary
 * Server Action. The form is the approval gate (AGENTS.md) and this endpoint
 * deliberately has no other door into the database.
 *
 * Order of the checks is the security and cost design, not style: the URL
 * guard, the fetch and the extraction all run BEFORE the provider is touched,
 * so a blocked page or a JS shell costs zero tokens — and, more importantly,
 * can never turn into an invented product.
 *
 * Not token-gated, like /api/coach: the app has no auth in v1 and sits behind
 * the same reverse proxy. The per-IP cap below is what stops it becoming an
 * open fetch proxy or an AI-cost spigot.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { fetchProductPage } from "@/lib/import/fetch-page";
import { extractProductText, extractPastedText, MIN_EXTRACT_CHARS, MAX_EXTRACT_CHARS } from "@/lib/import/extract";
import { draftProductFromText } from "@/lib/ai/product-draft";
import { hitLimit } from "@/lib/rate-limit";
import { getLocale } from "@/lib/settings";
import type { ErrorCode } from "@/lib/domain/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Imports per IP per hour (plan §4.1). */
const MAX_IMPORTS_PER_HOUR = 10;

/** Hard cap on pasted text, so the body itself cannot be the attack. */
const MAX_PASTE_CHARS = 50_000;

const bodySchema = z
  .object({
    kind: z.enum(["fertilizer", "food"]),
    url: z.string().max(2048).optional(),
    text: z.string().max(MAX_PASTE_CHARS).optional(),
  })
  .refine((b) => (b.url?.trim() ?? "") !== "" || (b.text?.trim() ?? "") !== "", {
    message: "Either url or text is required",
  });

function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

/**
 * English `error` for machines, `code` for the UI catalogs — the same contract
 * every write path in this app uses (lib/domain/errors.ts).
 */
function failure(code: ErrorCode, status: number, error: string) {
  return NextResponse.json({ ok: false, error, code }, { status });
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  if (hitLimit(`productImport:${ip}`, MAX_IMPORTS_PER_HOUR)) {
    return failure("productImport.rateLimited", 429, "Too many imports, try again later");
  }

  const parsedBody = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsedBody.success) {
    return failure("productImport.invalidUrl", 400, "kind is required, plus one of url or text");
  }
  const { kind, url, text } = parsedBody.data;

  // Pasted text skips the network entirely — that is the whole point of the
  // fallback: it works when the shop blocks us, and when there is no page at
  // all because the tin is in the user's hand.
  let extracted: { text: string; title: string | null };
  let sourceUrl: string | undefined;

  if (text && text.trim() !== "") {
    extracted = extractPastedText(text);
  } else {
    const page = await fetchProductPage(url ?? "");
    if (!page.ok) {
      const status = page.code === "productImport.blockedAddress" || page.code === "productImport.invalidUrl" ? 400 : 502;
      return failure(page.code, status, `Could not read the page (${page.code})`);
    }
    sourceUrl = page.finalUrl;
    extracted = extractProductText(page.html);
  }

  if (extracted.text.length < MIN_EXTRACT_CHARS) {
    return failure("productImport.tooThin", 422, "No product text found on that page");
  }

  const result = await draftProductFromText({
    pageText: extracted.text.slice(0, MAX_EXTRACT_CHARS),
    kind,
    locale: getLocale(),
    sourceLabel: sourceUrl ? new URL(sourceUrl).hostname : undefined,
  });

  if (!result.ok) {
    const status = result.code === "productImport.limitReached" ? 429 : result.code === "productImport.aiOffline" ? 503 : 422;
    return failure(result.code, status, `Could not draft a product (${result.code})`);
  }

  return NextResponse.json({ ok: true, draft: result.draft, notes: result.notes, sourceUrl });
}
