/*
 * Service worker — the offline shell for the installed app (mobile plan, stage 0).
 *
 * Deliberately small. It exists for two things: serve the static build output
 * without a round trip, and show a real page instead of the browser's error
 * dinosaur when the NAS is unreachable. It is NOT a data cache — schedules and
 * water values always come from the server, because a stale "due today" is
 * worse than no answer.
 *
 * THE TRAP THIS AVOIDS: Server Actions are POSTs to the page's own URL. A
 * "cache everything" worker swallows them and every Done/Snooze silently stops
 * working. Hence: GET only, same-origin only, and /api is never touched.
 */

const VERSION = "aquaman-v1";
const SHELL_CACHE = `${VERSION}-shell`;
const OFFLINE_URL = "/offline";

/** Cache-first paths: content-hashed by the build, so they can never go stale. */
const IMMUTABLE_PREFIXES = ["/_next/static/", "/icons/"];

const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png", "/apple-touch-icon.png"];

/**
 * Refetch the offline page. Its text is server-rendered in the install's
 * language, so a cached copy goes stale when the owner switches language in
 * /more — the page posts "sync-offline" on load to correct that.
 */
async function cacheOfflinePage() {
  const cache = await caches.open(SHELL_CACHE);
  const res = await fetch(OFFLINE_URL, { cache: "reload" });
  if (res.ok) await cache.put(OFFLINE_URL, res);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      // A failed precache must not block activation — the app still works
      // online, it just has no offline screen yet.
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "sync-offline") {
    event.waitUntil(cacheOfflinePage().catch(() => undefined));
  }
});

async function networkFirstNavigation(request) {
  try {
    return await fetch(request);
  } catch {
    const cached = await caches.match(OFFLINE_URL);
    // No cached offline page (precache failed) → let the browser show its own
    // error rather than resolving with an empty response.
    if (cached) return cached;
    throw new Error("offline and no cached fallback");
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok) {
    const cache = await caches.open(SHELL_CACHE);
    cache.put(request, res.clone());
  }
  return res;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Anything that can change server state stays untouched: Server Actions,
  // API writes, the ICS feed's conditional gets.
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Data is never cached — /api/v1 is token-gated and /api/health must be live.
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (IMMUTABLE_PREFIXES.some((p) => url.pathname.startsWith(p))) {
    event.respondWith(cacheFirst(request));
  }
});
