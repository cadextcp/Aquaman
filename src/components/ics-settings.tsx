"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { rotateIcsTokenAction } from "@/app/actions";

/** ICS subscribe URL + rotate button (Phase 3 — TechDesign §4.4/§8b). */
export function IcsSettings({ initialUrl }: { initialUrl: string }) {
  const router = useRouter();
  const [url, setUrl] = useState(initialUrl);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard API can be unavailable (non-HTTPS, permissions) — the URL is still selectable
    }
  }

  async function rotate() {
    if (!confirm("Rotate the ICS token? The current subscribe URL will stop working immediately.")) return;
    const res = await rotateIcsTokenAction();
    if (res.ok && res.data) {
      const base = url.split("?")[0];
      setUrl(`${base}?t=${res.data.token}`);
      startTransition(() => router.refresh());
    }
  }

  const input = { background: "var(--secondary)", border: "1px solid var(--border)", color: "inherit" };

  return (
    <div className="rounded-xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      <div className="text-xs uppercase tracking-wide mb-2" style={{ color: "var(--muted-foreground)" }}>
        Calendar feed (ICS)
      </div>
      <p className="text-sm mb-3" style={{ color: "var(--muted-foreground)" }}>
        Subscribe to this URL in Google Calendar (&quot;Other calendars → From URL&quot;). It updates automatically —
        Google refreshes external feeds roughly once a day.
      </p>
      <div className="flex flex-col sm:flex-row gap-2 mb-3">
        <input
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="flex-1 rounded-lg px-3 py-2.5 text-xs font-mono"
          style={input}
        />
        <button
          onClick={copy}
          type="button"
          className="rounded-lg px-4 py-2.5 text-sm font-medium whitespace-nowrap"
          style={{ background: "var(--secondary)", color: "var(--secondary-foreground)", minHeight: 44 }}
        >
          {copied ? "✓ Copied" : "Copy"}
        </button>
      </div>
      <button
        onClick={rotate}
        type="button"
        disabled={pending}
        className="text-xs underline"
        style={{ color: "var(--destructive)" }}
      >
        Rotate token (invalidates the current URL)
      </button>
    </div>
  );
}
