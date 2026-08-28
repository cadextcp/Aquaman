"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { rotateMcpTokenAction } from "@/app/actions";

/**
 * MCP endpoint + token settings (product v1.1 — TechDesign §4.6).
 * The whole /api/mcp surface is bearer-gated; agents (OpenClaw) configure
 * this URL plus the token as an Authorization header.
 */
export function McpSettings({ endpointUrl, token }: { endpointUrl: string; token: string }) {
  const router = useRouter();
  const [currentToken, setCurrentToken] = useState(token);
  const [copied, setCopied] = useState<"url" | "token" | null>(null);
  const [pending, startTransition] = useTransition();

  async function copy(what: "url" | "token") {
    try {
      await navigator.clipboard.writeText(what === "url" ? endpointUrl : currentToken);
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // clipboard API can be unavailable (non-HTTPS, permissions) — values stay selectable
    }
  }

  async function rotate() {
    if (!confirm("Rotate the MCP token? Every configured agent loses access immediately until you update it.")) return;
    const res = await rotateMcpTokenAction();
    if (res.ok && res.data) setCurrentToken(res.data.token);
    startTransition(() => router.refresh());
  }

  const input = { background: "var(--secondary)", border: "1px solid var(--border)", color: "inherit" };

  return (
    <div className="rounded-xl p-5 mb-4 edge-card">
      <div className="text-xs uppercase tracking-wide mb-2" style={{ color: "var(--muted-foreground)" }}>
        MCP endpoint (for agents like OpenClaw)
      </div>
      <p className="text-sm mb-3" style={{ color: "var(--muted-foreground)" }}>
        Remote agents read tank state and record care via the Model Context Protocol. Configure the URL and send the
        token as <code className="text-xs">Authorization: Bearer</code> header. Write tools can log care — nothing can
        be deleted or rewritten remotely.
      </p>
      <div className="flex flex-col sm:flex-row gap-2 mb-3">
        <input
          readOnly
          value={endpointUrl}
          onFocus={(e) => e.currentTarget.select()}
          className="flex-1 rounded-lg px-3 py-2.5 text-xs font-mono"
          style={input}
        />
        <button
          onClick={() => copy("url")}
          type="button"
          className="btn-outline inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-medium whitespace-nowrap"
          style={{ minHeight: 44 }}
        >
          {copied === "url" ? <><i aria-hidden className="ph ph-check" /> Copied</> : "Copy URL"}
        </button>
      </div>
      <div className="flex flex-col sm:flex-row gap-2 mb-3">
        <input
          readOnly
          value={currentToken}
          onFocus={(e) => e.currentTarget.select()}
          className="flex-1 rounded-lg px-3 py-2.5 text-xs font-mono"
          style={input}
        />
        <button
          onClick={() => copy("token")}
          type="button"
          className="btn-outline inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-medium whitespace-nowrap"
          style={{ minHeight: 44 }}
        >
          {copied === "token" ? <><i aria-hidden className="ph ph-check" /> Copied</> : "Copy token"}
        </button>
      </div>
      <button
        onClick={rotate}
        type="button"
        disabled={pending}
        className="text-xs underline"
        style={{ color: "var(--destructive)" }}
      >
        Rotate token (invalidates the current one)
      </button>
    </div>
  );
}
