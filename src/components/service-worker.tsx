"use client";

import { useEffect } from "react";

/**
 * Registers public/sw.js (mobile plan, stage 0).
 *
 * Production only: in `next dev` a worker caching the build output serves
 * yesterday's chunks after a hot reload, which looks exactly like a broken app.
 *
 * The "sync-offline" message re-fetches the cached offline page. That page is
 * server-rendered in the install's language, so without this a language switch
 * in /more would leave the offline screen in the old one until the worker
 * itself changed — the failure tests/i18n.test.ts exists to prevent.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    let cancelled = false;

    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then(() => navigator.serviceWorker.ready)
      .then((registration) => {
        if (!cancelled) registration.active?.postMessage({ type: "sync-offline" });
      })
      // A refused registration (private mode, no HTTPS) is not an app error —
      // the app works, it just has no offline shell.
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
