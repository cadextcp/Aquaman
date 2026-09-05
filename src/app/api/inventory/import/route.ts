/**
 * POST /api/inventory/import — draft a NEW inventory product from a product
 * page or from pasted label text (docs/plan-produkt-import-url.md §3).
 *
 * Request:  { kind: "fertilizer" | "food", url?: string, text?: string,
 *           imageBase64?: string } — exactly one of the three sources
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
import { draftProductFromText, draftProductFromImage, type DraftResult } from "@/lib/ai/product-draft";
import { prepareLabelImage, LabelImageError } from "@/lib/import/prepare-image";
import { hitLimit } from "@/lib/rate-limit";
import { getLocale } from "@/lib/settings";
import type { ErrorCode } from "@/lib/domain/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Imports per IP per hour (plan §4.1). */
const MAX_IMPORTS_PER_HOUR = 10;

/** Hard cap on pasted text, so the body itself cannot be the attack. */
const MAX_PASTE_CHARS = 50_000;

/**
 * base64 cap for the label photo — the same 5 MB ceiling prepare-image.ts
 * enforces on the decoded bytes, ×4/3 for base64. A route handler has no
 * Next-level body limit (bodySizeLimit is Server-Actions-only), so THIS cap is
 * the request-size guard.
 */
const MAX_PHOTO_B64_CHARS = 7_000_000;

const bodySchema = z
  .object({
    kind: z.enum(["fertilizer", "food"]),
    url: z.string().max(2048).optional(),
    text: z.string().max(MAX_PASTE_CHARS).optional(),
    imageBase64: z.string().max(MAX_PHOTO_B64_CHARS).optional(),
  })
  .refine((b) => [b.url, b.text, b.imageBase64].filter((v) => (v?.trim() ?? "") !== "").length === 1, {
    message: "kind is required, plus exactly one of url, text or imageBase64",
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
    return failure("productImport.invalidUrl", 400, "kind is required, plus exactly one of url, text or imageBase64");
  }
  const { kind, url, text, imageBase64 } = parsedBody.data;

  let result: DraftResult;
  let sourceUrl: string | undefined;

  if (imageBase64) {
    // Decode and refuse BEFORE the provider — an unreadable or oversized file
    // costs zero tokens, the same pre-AI ordering the URL path applies to its
    // fetch. The photo is also never written anywhere: prepare, send, discard.
    try {
      const prepared = await prepareLabelImage(imageBase64);
      result = await draftProductFromImage({
        image: { base64: prepared.base64, mediaType: "image/jpeg" },
        kind,
        locale: getLocale(),
      });
    } catch (err) {
      if (err instanceof LabelImageError) {
        return failure(err.code, err.code === "productImport.imageTooLarge" ? 413 : 422, `${err.message} (${err.code})`);
      }
      throw err;
    }
  } else {
    // Pasted text skips the network entirely — that is the whole point of the
    // fallback: it works when the shop blocks us, and when there is no page at
    // all because the tin is in the user's hand.
    let extracted: { text: string; title: string | null };
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

    result = await draftProductFromText({
      pageText: extracted.text.slice(0, MAX_EXTRACT_CHARS),
      kind,
      locale: getLocale(),
      sourceLabel: sourceUrl ? new URL(sourceUrl).hostname : undefined,
    });
  }

  if (!result.ok) {
    const status = result.code === "productImport.limitReached" ? 429 : result.code === "productImport.aiOffline" ? 503 : 422;
    return failure(result.code, status, `Could not draft a product (${result.code})`);
  }

  return NextResponse.json({ ok: true, draft: result.draft, notes: result.notes, sourceUrl });
}
