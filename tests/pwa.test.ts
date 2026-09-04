/**
 * PWA guardrails (mobile plan, stage 0).
 *
 * Two failure modes this pins, both silent in CI and only visible on a phone:
 *  1. the manifest promises an icon file that isn't there — the home screen
 *     falls back to a screenshot thumbnail and the install looks broken
 *  2. the service worker starts answering non-GET requests — Server Actions
 *     are POSTs to the page's own URL, so every Done/Snooze would stop working
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import manifest from "../src/app/manifest";

const PUBLIC = path.resolve(__dirname, "..", "public");

describe("web app manifest", () => {
  const m = manifest();

  it("carries the fields a browser needs to offer an install", () => {
    expect(m.name).toBeTruthy();
    expect(m.short_name).toBeTruthy();
    expect(m.start_url).toBe("/");
    expect(m.display).toBe("standalone");
    expect(m.icons?.length).toBeGreaterThan(0);
  });

  it("resolves its copy instead of shipping raw dot-keys", () => {
    // t() returns the key itself when a catalog entry is missing
    for (const value of [m.name, m.short_name, m.description]) {
      expect(typeof value).toBe("string");
      expect(value).not.toMatch(/^app\./);
    }
  });

  it("uses one hex color for theme and background", () => {
    expect(m.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(m.background_color).toBe(m.theme_color);
  });

  it("ships a maskable icon — Android crops a full-bleed one to a circle", () => {
    const maskable = m.icons?.filter((i) => i.purpose === "maskable") ?? [];
    expect(maskable.length).toBeGreaterThan(0);
  });

  it("every declared icon exists and really has the declared size", async () => {
    for (const icon of m.icons ?? []) {
      const file = path.join(PUBLIC, icon.src!);
      expect(existsSync(file), `${icon.src} is declared but missing from public/`).toBe(true);

      // The generator once produced a 614px file for a 512px request (sharp
      // resizes before it extends), which no amount of reading the code showed.
      const { width, height } = await sharp(file).metadata();
      expect(`${width}x${height}`, `${icon.src} does not match its manifest size`).toBe(icon.sizes);
    }
  });

  it("ships an apple touch icon — iOS ignores the manifest icons entirely", () => {
    expect(existsSync(path.join(PUBLIC, "apple-touch-icon.png"))).toBe(true);
  });
});

/**
 * Loads public/sw.js with injected globals and returns the handlers it
 * registered, so the fetch logic can be exercised instead of grepped.
 */
function loadServiceWorker() {
  const src = readFileSync(path.join(PUBLIC, "sw.js"), "utf8");
  const handlers: Record<string, (event: unknown) => void> = {};
  const self = {
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      handlers[type] = fn;
    },
    location: { origin: "https://aquaman.local" },
    clients: { claim: () => Promise.resolve() },
    skipWaiting: () => Promise.resolve(),
  };
  const caches = { open: async () => ({ put: async () => {}, addAll: async () => {} }), match: async () => undefined };
  const fetchStub = async () => ({ ok: true, clone: () => ({}) });

  new Function("self", "caches", "fetch", src)(self, caches, fetchStub);
  return handlers;
}

describe("service worker fetch routing", () => {
  const handlers = loadServiceWorker();

  /** Runs the fetch handler and reports whether the worker took over the request. */
  function intercepts(request: { method?: string; url: string; mode?: string }): boolean {
    let handled = false;
    handlers.fetch!({
      request: { method: "GET", mode: "no-cors", ...request },
      respondWith: () => {
        handled = true;
      },
    });
    return handled;
  }

  const origin = "https://aquaman.local";

  it("registers install, activate and fetch", () => {
    for (const type of ["install", "activate", "fetch"]) expect(handlers[type]).toBeTypeOf("function");
  });

  it("never intercepts a Server Action — they are POSTs to the page's own URL", () => {
    expect(intercepts({ method: "POST", url: `${origin}/`, mode: "navigate" })).toBe(false);
    expect(intercepts({ method: "POST", url: `${origin}/tanks/1` })).toBe(false);
  });

  it("never intercepts the API — token-gated and must stay live", () => {
    expect(intercepts({ url: `${origin}/api/v1/tasks` })).toBe(false);
    expect(intercepts({ url: `${origin}/api/health` })).toBe(false);
  });

  it("leaves cross-origin requests alone", () => {
    expect(intercepts({ url: "https://example.com/thing.js" })).toBe(false);
  });

  it("takes over navigations, so an unreachable server gets the offline page", () => {
    expect(intercepts({ url: `${origin}/`, mode: "navigate" })).toBe(true);
  });

  it("serves the hashed build output from cache", () => {
    expect(intercepts({ url: `${origin}/_next/static/chunks/main.js` })).toBe(true);
    expect(intercepts({ url: `${origin}/icons/icon-192.png` })).toBe(true);
  });
});
