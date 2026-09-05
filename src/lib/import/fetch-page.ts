/**
 * Fetch one product page for the import (docs/plan-produkt-import-url.md §4.1).
 *
 * Redirects are followed BY HAND (`redirect: "manual"`) for one reason: every
 * hop has to go through the SSRF guard again. Letting `fetch` follow a chain
 * would mean a shop's 302 to `http://192.168.178.3` walks straight past the
 * check we did on the URL the user typed.
 *
 * Everything else here is a limit: 8 s, 2 MB, HTML only, three hops. A product
 * page that needs more than that is not a product page.
 */

import type { ErrorCode } from "@/lib/domain/errors";
import { parseImportUrl, resolveTarget, type Lookup } from "./url-guard";

export const FETCH_TIMEOUT_MS = 8_000;
export const MAX_BYTES = 2 * 1024 * 1024;
export const MAX_REDIRECTS = 3;

/**
 * An honest, identifiable agent. Pretending to be a browser would get through
 * more bot walls, but a self-hosted app that lies about who it is earns the
 * block it eventually gets — and §7 already has a good answer for a refusal.
 */
const USER_AGENT = "Aquaman/1.0 (self-hosted aquarium app; product import)";

export type PageFetch = { ok: true; html: string; finalUrl: string } | { ok: false; code: ErrorCode };

export type FetchDeps = { fetchImpl?: typeof fetch; lookupFn?: Lookup };

/** Read at most `MAX_BYTES`, then stop pulling — a 4 GB "page" must not fill the container. */
async function readCapped(response: Response): Promise<string> {
  if (!response.body) return await response.text();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  await reader.cancel().catch(() => {});
  // The loop stops AFTER the chunk that crosses the cap, so `total` can
  // overshoot by one chunk — truncate here or MAX_BYTES is a suggestion.
  const size = Math.min(total, MAX_BYTES);
  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    if (offset >= size) break;
    const room = Math.min(chunk.byteLength, size - offset);
    merged.set(chunk.subarray(0, room), offset);
    offset += room;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(merged);
}

/**
 * `raw` is whatever the user typed. Returns the page HTML, or the code the UI
 * turns into one of the §7 messages.
 */
export async function fetchProductPage(raw: string, deps: FetchDeps = {}): Promise<PageFetch> {
  const fetchImpl = deps.fetchImpl ?? fetch;

  const parsed = parseImportUrl(raw);
  if (!parsed.ok) return parsed;

  let target = parsed.url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const resolved = await resolveTarget(target, deps.lookupFn);
    if (!resolved.ok) return resolved;

    let response: Response;
    try {
      response = await fetchImpl(target, {
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
      });
    } catch {
      // Timeout, DNS, TLS, connection refused — all the same to the user.
      return { ok: false, code: "productImport.unreachable" };
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return { ok: false, code: "productImport.unreachable" };
      let next: URL;
      try {
        next = new URL(location, target); // relative Location is legal
      } catch {
        return { ok: false, code: "productImport.invalidUrl" };
      }
      // The whole reason for manual redirects: re-run the URL checks on the hop.
      const checked = parseImportUrl(next.toString());
      if (!checked.ok) return checked;
      target = checked.url;
      continue;
    }

    // 401/403/429 is a bot wall, not a broken link — the UI says so and offers
    // pasting the text instead.
    if (response.status === 401 || response.status === 403 || response.status === 429) {
      return { ok: false, code: "productImport.blocked" };
    }
    if (!response.ok) return { ok: false, code: "productImport.unreachable" };

    const contentType = response.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      return { ok: false, code: "productImport.notHtml" };
    }

    let html: string;
    try {
      html = await readCapped(response);
    } catch {
      return { ok: false, code: "productImport.unreachable" };
    }
    return { ok: true, html, finalUrl: target.toString() };
  }

  // More hops than allowed — a redirect loop or a tracker chain.
  return { ok: false, code: "productImport.unreachable" };
}
