"use client";

/**
 * Coach chat UI (Phase 4 — PRD §5.6). Streams NDJSON from /api/coach,
 * renders proposals as approval cards (the gate is the ONLY write path),
 * and always degrades gracefully: unconfigured → info card, 429 → paused
 * message, network error → fallback note.
 */

import { useEffect, useRef, useState } from "react";
import { applyProposal } from "@/app/actions-ai";
import type { Proposal } from "@/lib/ai/proposal";

type Msg = { role: "user" | "assistant"; content: string; proposal?: Proposal };

type UsageInfo = { calls: number; totalTokens: number; maxCalls: number; maxTokens: number } | null;

export function CoachChat({ aiConfigured }: { aiConfigured: boolean }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<UsageInfo>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function ask() {
    const question = input.trim();
    if (!question || busy || busyRef.current) return;
    setBusy(true);
    busyRef.current = true;
    setInput("");
    setBanner(null);

    const history = messages
      .filter((m) => m.content.trim().length > 0)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));

    setMessages((prev) => [...prev, { role: "user", content: question }, { role: "assistant", content: "" }]);

    try {
      const res = await fetch("/api/coach", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, history }),
      });

      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = {
            role: "assistant",
            content: data?.error ?? "AI is offline — core features are fully working without it.",
          };
          return copy;
        });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // NDJSON: process complete lines only
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          let ev: Record<string, unknown>;
          try {
            ev = JSON.parse(line);
          } catch {
            continue;
          }
          handleEvent(ev);
        }
      }
    } catch {
      setMessages((prev) => {
        const copy = [...prev];
        copy[copy.length - 1] = { role: "assistant", content: "AI is unreachable — core features are fully working without it." };
        return copy;
      });
    } finally {
      setBusy(false);
      busyRef.current = false;
    }
  }

  function handleEvent(ev: Record<string, unknown>) {
    switch (ev.type) {
      case "usage":
        setUsage({
          calls: Number(ev.calls ?? 0),
          totalTokens: Number(ev.totalTokens ?? 0),
          maxCalls: Number(ev.maxCalls ?? 0),
          maxTokens: Number(ev.maxTokens ?? 0),
        });
        break;
      case "text":
        setMessages((prev) => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          if (last && last.role === "assistant") copy[copy.length - 1] = { ...last, content: last.content + String(ev.delta ?? "") };
          return copy;
        });
        break;
      case "proposal": {
        const proposal = ev.proposal as Proposal | undefined;
        if (!proposal) break;
        setMessages((prev) => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          if (last && last.role === "assistant") copy[copy.length - 1] = { ...last, proposal };
          return copy;
        });
        break;
      }
      case "error":
        setBanner(String(ev.message ?? "AI error"));
        break;
      case "done":
        break;
      default:
        break;
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {!aiConfigured && (
        <div className="rounded-xl p-4 text-sm" style={{ background: "var(--secondary)", border: "1px solid var(--border)" }}>
          AI is not configured — set <code>AQUAMAN_AI_API_KEY</code> (and optionally <code>AQUAMAN_AI_BASE_URL</code> /{" "}
          <code>AQUAMAN_AI_MODEL</code>) to enable the coach. Everything else works without it.
        </div>
      )}

      {messages.length === 0 && (
        <div className="rounded-xl p-4 text-sm" style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--muted-foreground)" }}>
          Ask about your tanks, values or plan — e.g. <em>&quot;Nitrite is 0.3, what should I do?&quot;</em> or{" "}
          <em>&quot;Set up a care plan for my new tank&quot;</em>. Schedule changes arrive as proposals you approve.
        </div>
      )}

      {messages.map((m, i) => (
        <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
          <div
            className="rounded-xl px-4 py-3 max-w-[85%] text-sm whitespace-pre-wrap"
            style={
              m.role === "user"
                ? { background: "var(--accent)", color: "#fff" }
                : { background: "var(--card)", border: "1px solid var(--border)" }
            }
          >
            {m.content}
            {m.proposal && <ProposalCard proposal={m.proposal} />}
          </div>
        </div>
      ))}
      <div ref={endRef} />

      {banner && (
        <div className="rounded-xl p-3 text-sm" style={{ background: "var(--secondary)", border: "1px solid var(--border)", color: "var(--warning)" }}>
          {banner}
        </div>
      )}

      <div className="flex gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              ask();
            }
          }}
          rows={2}
          placeholder="Ask the coach…"
          disabled={!aiConfigured}
          className="flex-1 rounded-lg px-3 py-2.5 text-sm resize-none"
          style={{ background: "var(--secondary)", border: "1px solid var(--border)", color: "inherit", minHeight: 44 }}
        />
        <button
          onClick={ask}
          disabled={busy || !aiConfigured || input.trim().length === 0}
          className="rounded-lg px-5 text-sm font-medium"
          style={{ background: "var(--accent)", color: "#fff", minHeight: 44, opacity: busy || !aiConfigured ? 0.6 : 1 }}
        >
          {busy ? "…" : "Ask"}
        </button>
      </div>

      <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
        AI tips are recommendations — not medication dosages. For disease questions consult a specialist retailer.
        {usage && (
          <>
            {" "}
            · Today: {usage.calls}/{usage.maxCalls} calls, {usage.totalTokens.toLocaleString()}/{usage.maxTokens.toLocaleString()} tokens
          </>
        )}
      </p>
    </div>
  );
}

function ProposalCard({ proposal }: { proposal: Proposal }) {
  const [state, setState] = useState<"pending" | "applied" | "failed" | "partial">("pending");
  const [result, setResult] = useState<string>("");

  async function apply() {
    const res = await applyProposal(proposal);
    if (res.ok && res.data) {
      const skipped = res.data.skipped;
      setState(skipped.length > 0 ? (res.data.applied.length > 0 ? "partial" : "failed") : "applied");
      setResult(
        [
          res.data.applied.length > 0 ? `Applied: ${res.data.applied.join("; ")}` : "",
          skipped.length > 0 ? `Skipped: ${skipped.map((s) => `${s.change} (${s.reason})`).join("; ")}` : "",
        ]
          .filter(Boolean)
          .join(" · "),
      );
    } else {
      setState("failed");
      setResult(res.ok ? "" : res.error);
    }
  }

  return (
    <div className="mt-3 rounded-lg p-3" style={{ background: "var(--secondary)", border: "1px dashed var(--border)" }}>
      <div className="text-xs uppercase tracking-wide mb-1" style={{ color: "var(--accent)" }}>
        Proposed schedule change (draft)
      </div>
      <p className="text-sm mb-2">{proposal.rationale}</p>
      <ul className="text-sm space-y-1 mb-2" style={{ color: "var(--muted-foreground)" }}>
        {proposal.changes.map((c, i) => (
          <li key={i}>
            {c.kind === "create"
              ? `+ ${c.actionType.replace(/_/g, " ")} every ${c.intervalDays}d (mask ${c.preferredDays})`
              : `~ schedule #${c.scheduleId} → every ${c.intervalDays}d`}
            {c.note ? ` — ${c.note}` : ""}
          </li>
        ))}
      </ul>
      {state === "pending" ? (
        <button
          onClick={apply}
          className="rounded-lg px-4 py-2 text-sm font-medium"
          style={{ background: "var(--accent)", color: "#fff", minHeight: 44 }}
        >
          Approve &amp; apply
        </button>
      ) : (
        <div className="text-sm">
          {state === "applied" && <span style={{ color: "var(--success)" }}>✓ {result || "Applied"}</span>}
          {state === "partial" && <span style={{ color: "var(--warning)" }}>◐ {result}</span>}
          {state === "failed" && <span style={{ color: "var(--destructive)" }}>✗ {result || "Failed — nothing was written"}</span>}
        </div>
      )}
    </div>
  );
}
