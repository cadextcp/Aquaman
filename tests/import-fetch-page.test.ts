/**
 * The fetch layer (src/lib/import/fetch-page.ts).
 *
 * The case that matters most is the redirect: a shop is allowed to bounce us
 * around, but every hop has to go through the SSRF guard again. A 302 into the
 * LAN is the exact shape of the attack this feature would otherwise open.
 *
 * No real network here — `fetchImpl` and the DNS lookup are both injected.
 */
import { describe, it, expect, vi } from "vitest";
import { fetchProductPage, MAX_BYTES, MAX_REDIRECTS } from "../src/lib/import/fetch-page";
import type { Lookup } from "../src/lib/import/url-guard";

const publicDns: Lookup = async () => [{ address: "93.184.216.34" }];

function html(body: string, init: { status?: number; type?: string } = {}): Response {
  return new Response(body, {
    status: init.status ?? 200,
    headers: { "content-type": init.type ?? "text/html; charset=utf-8" },
  });
}

function redirect(to: string, status = 302): Response {
  return new Response(null, { status, headers: { location: to } });
}

describe("fetchProductPage", () => {
  it("returns the HTML of a normal page", async () => {
    const fetchImpl = vi.fn(async () => html("<html><body><h1>Futter</h1></body></html>"));
    const res = await fetchProductPage("https://shop.example.com/p/1", { fetchImpl: fetchImpl as never, lookupFn: publicDns });
    expect(res).toEqual({ ok: true, html: "<html><body><h1>Futter</h1></body></html>", finalUrl: "https://shop.example.com/p/1" });
  });

  it("identifies itself and never follows redirects on its own", async () => {
    let seen: (RequestInit & { headers: Record<string, string> }) | null = null;
    const fetchImpl = vi.fn(async (_url: unknown, init: unknown) => {
      seen = init as RequestInit & { headers: Record<string, string> };
      return html("<html>ok</html>");
    });
    await fetchProductPage("https://shop.example.com/p", { fetchImpl: fetchImpl as never, lookupFn: publicDns });
    const init = seen as unknown as RequestInit & { headers: Record<string, string> };
    expect(init).not.toBeNull();
    expect(init.redirect).toBe("manual");
    expect(init.headers["user-agent"]).toContain("Aquaman");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("follows a public redirect and reports the final URL", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(redirect("https://shop.example.com/p/final"))
      .mockResolvedValueOnce(html("<html>final</html>"));
    const res = await fetchProductPage("https://shop.example.com/p", { fetchImpl: fetchImpl as never, lookupFn: publicDns });
    expect(res).toEqual({ ok: true, html: "<html>final</html>", finalUrl: "https://shop.example.com/p/final" });
  });

  it("resolves a relative Location against the current hop", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(redirect("/de/p/2")).mockResolvedValueOnce(html("<html>zwei</html>"));
    const res = await fetchProductPage("https://shop.example.com/p/1", { fetchImpl: fetchImpl as never, lookupFn: publicDns });
    expect(res.ok && res.finalUrl).toBe("https://shop.example.com/de/p/2");
  });

  // The attack: the typed URL is fine, the redirect is not.
  it("refuses a redirect into the LAN", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(redirect("http://192.168.178.3/api/v2.0/system/info"));
    const res = await fetchProductPage("https://shop.example.com/p", { fetchImpl: fetchImpl as never, lookupFn: publicDns });
    expect(res).toEqual({ ok: false, code: "productImport.blockedAddress" });
    expect(fetchImpl).toHaveBeenCalledTimes(1); // never actually requested the NAS
  });

  it("refuses a redirect to a non-http scheme", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(redirect("file:///etc/passwd"));
    const res = await fetchProductPage("https://shop.example.com/p", { fetchImpl: fetchImpl as never, lookupFn: publicDns });
    expect(res).toEqual({ ok: false, code: "productImport.invalidUrl" });
  });

  it("gives up on a redirect loop", async () => {
    const fetchImpl = vi.fn(async () => redirect("https://shop.example.com/loop"));
    const res = await fetchProductPage("https://shop.example.com/loop", { fetchImpl: fetchImpl as never, lookupFn: publicDns });
    expect(res).toEqual({ ok: false, code: "productImport.unreachable" });
    expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(MAX_REDIRECTS + 1);
  });

  it("reports a bot wall separately from a broken link", async () => {
    for (const status of [401, 403, 429]) {
      const fetchImpl = vi.fn(async () => html("nope", { status }));
      const res = await fetchProductPage("https://shop.example.com/p", { fetchImpl: fetchImpl as never, lookupFn: publicDns });
      expect(res, String(status)).toEqual({ ok: false, code: "productImport.blocked" });
    }
  });

  it("treats other error statuses as unreachable", async () => {
    for (const status of [404, 500, 503]) {
      const fetchImpl = vi.fn(async () => html("nope", { status }));
      const res = await fetchProductPage("https://shop.example.com/p", { fetchImpl: fetchImpl as never, lookupFn: publicDns });
      expect(res, String(status)).toEqual({ ok: false, code: "productImport.unreachable" });
    }
  });

  it("refuses anything that is not HTML", async () => {
    for (const type of ["application/pdf", "image/jpeg", "application/json"]) {
      const fetchImpl = vi.fn(async () => html("...", { type }));
      const res = await fetchProductPage("https://shop.example.com/p", { fetchImpl: fetchImpl as never, lookupFn: publicDns });
      expect(res, type).toEqual({ ok: false, code: "productImport.notHtml" });
    }
  });

  it("turns a thrown fetch (timeout, DNS, TLS) into unreachable", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("The operation was aborted due to timeout");
    });
    const res = await fetchProductPage("https://shop.example.com/p", { fetchImpl: fetchImpl as never, lookupFn: publicDns });
    expect(res).toEqual({ ok: false, code: "productImport.unreachable" });
  });

  it("stops reading an oversized body at the cap", async () => {
    const fetchImpl = vi.fn(async () => html("a".repeat(MAX_BYTES + 50_000)));
    const res = await fetchProductPage("https://shop.example.com/p", { fetchImpl: fetchImpl as never, lookupFn: publicDns });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.html.length).toBeLessThanOrEqual(MAX_BYTES);
  });

  it("rejects a bad URL before any request goes out", async () => {
    const fetchImpl = vi.fn();
    const res = await fetchProductPage("http://192.168.178.3/", { fetchImpl: fetchImpl as never, lookupFn: publicDns });
    expect(res).toEqual({ ok: false, code: "productImport.blockedAddress" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a hostname that resolves privately, before any request goes out", async () => {
    const fetchImpl = vi.fn();
    const lanDns: Lookup = async () => [{ address: "10.0.0.9" }];
    const res = await fetchProductPage("https://looks-fine.example.com/p", { fetchImpl: fetchImpl as never, lookupFn: lanDns });
    expect(res).toEqual({ ok: false, code: "productImport.blockedAddress" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
