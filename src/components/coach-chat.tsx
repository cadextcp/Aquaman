"use client";

/**
 * Coach chat UI (Phase 4 — PRD §5.6). Streams NDJSON from /api/coach,
 * renders proposals as approval cards (the gate is the ONLY write path),
 * and always degrades VISIBLY: every turn ends with content in the bubble —
 * text, a proposal, or an explicit error/“no answer” note (2026-08-30: an
 * empty stream used to leave a permanently empty bubble).
 */

import { useEffect, useRef, useState } from "react";
import { applyProposal } from "@/app/actions-ai";
import { PlanReviewBanner } from "./plan-review-banner";
import { MAX_HISTORY_MESSAGES } from "@/lib/ai/constants";
import type { Proposal } from "@/lib/ai/proposal";
import { StatusNote } from "./ui/status-note";
import { useI18n } from "@/i18n/provider";

type Msg = { role: "user" | "assistant"; content: string; proposal?: Proposal; tone?: "error" | "warning" };

type UsageInfo = { calls: number; totalTokens: number; maxCalls: number; maxTokens: number } | null;

type Suggestion = { label: string; prompt: string };

/**
 * Render the env-var names inside a translated sentence as <code>. The names
 * are interpolated, so the catalog string stays one translatable sentence
 * instead of three fragments a translator would have to reassemble.
 */
function withCode(text: string): React.ReactNode[] {
  return text.split(/(AQUAMAN_[A-Z_]+)/).map((part, i) =>
    /^AQUAMAN_[A-Z_]+$/.test(part) ? <code key={i}>{part}</code> : <span key={i}>{part}</span>,
  );
}

export function CoachChat({
  aiConfigured,
  initialQuestion,
  tankId,
}: {
  aiConfigured: boolean;
  initialQuestion?: string;
  /** The one tank this conversation is scoped to (Coach page's tank selector) — sent with every /api/coach call. */
  tankId: number;
}) {
  const { t, formatNumber } = useI18n();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<UsageInfo>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestionsLoaded, setSuggestionsLoaded] = useState(false);

  // issue #41: load today's clickable suggestions once (cached per day server-side)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/coach/suggestions");
        if (res.ok) {
          const data = (await res.json()) as { items?: Suggestion[] };
          if (!cancelled) setSuggestions(data.items ?? []);
        }
      } catch {
        /* offline/AI off → no chips, everything else works */
      } finally {
        if (!cancelled) setSuggestionsLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  const endRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // issue #42: banner deep-link (?q=…) sends the prepared question once
  const sentInitial = useRef(false);
  useEffect(() => {
    if (initialQuestion && !sentInitial.current) {
      sentInitial.current = true;
      askWithQuestion(initialQuestion);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuestion]);

  async function ask() {
    const question = input.trim();
    await askWithQuestion(question);
  }

  async function askWithQuestion(question: string) {
    if (!question || busy || busyRef.current) return;
    setBusy(true);
    busyRef.current = true;
    setInput("");

    // Trim to what the route actually accepts — an unbounded history here
    // used to break the chat permanently after ~7 exchanges (route.ts 400s
    // once its own cap is exceeded); the route now truncates too, but there's
    // no reason to grow the wire payload forever either.
    const history = messages
      .filter((m) => m.content.trim().length > 0)
      .slice(-MAX_HISTORY_MESSAGES)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));

    setMessages((prev) => [...prev, { role: "user", content: question }, { role: "assistant", content: "" }]);

    // Every turn MUST end with something visible in the bubble — an error, or
    // an explicit "no answer" note. A stream that ends without any content
    // (provider quirk, proxy cut) used to leave a permanently empty bubble.
    const saw = { output: false };

    try {
      const res = await fetch("/api/coach", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, history, tankId }),
      });

      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = {
            role: "assistant",
            content: data?.error ?? t("coach.offline"),
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
          handleEvent(ev, saw);
        }
      }
      if (!saw.output) {
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = {
            role: "assistant",
            content: t("coach.noAnswer"),
            tone: "warning",
          };
          return copy;
        });
      }
    } catch {
      setMessages((prev) => {
        const copy = [...prev];
        copy[copy.length - 1] = { role: "assistant", content: t("coach.unreachable") };
        return copy;
      });
    } finally {
      setBusy(false);
      busyRef.current = false;
    }
  }

  function handleEvent(ev: Record<string, unknown>, saw: { output: boolean }) {
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
        if (String(ev.delta ?? "")) saw.output = true;
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
        saw.output = true;
        setMessages((prev) => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          if (last && last.role === "assistant") copy[copy.length - 1] = { ...last, proposal };
          return copy;
        });
        break;
      }
      case "error": {
        // The message belongs IN the bubble where the answer was expected —
        // a separate banner alone left the bubble empty and easy to miss.
        saw.output = true;
        const message = String(ev.message ?? t("coach.aiError"));
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = { role: "assistant", content: message, tone: "error" };
          return copy;
        });
        break;
      }
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
          {withCode(
            t("coach.notConfigured", {
              key: "AQUAMAN_AI_API_KEY",
              baseUrl: "AQUAMAN_AI_BASE_URL",
              model: "AQUAMAN_AI_MODEL",
            }),
          )}
        </div>
      )}

      {messages.length === 0 && (
        <div className="rounded-xl p-4 text-sm edge-card" style={{ color: "var(--muted-foreground)" }}>
          {t("coach.intro")}
        </div>
      )}

      {messages.map((m, i) => (
        <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
          <div
            className="rounded-xl px-4 py-3 max-w-[85%] text-sm whitespace-pre-wrap"
            style={
              m.role === "user"
                ? { background: "var(--accent-soft)", boxShadow: "inset 0 0 0 1px var(--accent-edge)", borderRadius: "13px 13px 4px 13px" }
                : { background: "var(--surface)", boxShadow: "inset 0 1px 0 var(--surface)", borderRadius: "13px 13px 13px 4px" }
            }
          >
            {m.tone ? <StatusNote tone={m.tone}>{m.content}</StatusNote> : m.content}
            {m.proposal && <ProposalCard proposal={m.proposal} />}
          </div>
        </div>
      ))}
      <div ref={endRef} />

      <PlanReviewBanner onUsePrompt={(prompt) => askWithQuestion(prompt)} />

      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((sg) => (
            <button
              key={sg.label}
              type="button"
              onClick={() => {
                setInput(sg.prompt);
                // send immediately — one tap, like the design's ask-chips
                askWithQuestion(sg.prompt);
              }}
              className="rounded-full px-3 py-1.5 text-xs"
              style={{
                background: "var(--accent-soft)",
                boxShadow: "inset 0 0 0 1px var(--accent-edge)",
                color: "var(--accent-light)",
                cursor: "pointer",
              }}
            >
              {sg.label}
            </button>
          ))}
        </div>
      )}
      {suggestionsLoaded && suggestions.length === 0 && aiConfigured && null}

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
          maxLength={2000} // MAX_QUESTION_CHARS in api/coach/route.ts
          placeholder={t("coach.placeholder")}
          disabled={!aiConfigured}
          className="flex-1 rounded-lg px-3 py-2.5 text-sm resize-none"
          style={{ background: "var(--secondary)", border: "1px solid var(--border)", color: "inherit", minHeight: 44 }}
        />
        <button
          onClick={ask}
          disabled={busy || !aiConfigured || input.trim().length === 0}
          className="btn-outline rounded-lg px-5 text-sm font-medium"
          style={{ minHeight: 44, opacity: busy || !aiConfigured ? 0.6 : 1 }}
        >
          {busy ? "…" : t("coach.send")}
        </button>
      </div>

      <p className="text-xs" style={{ color: "var(--faint)" }}>
        {t("coach.disclaimer")}
        {usage && (
          <>
            {" "}
            ·{" "}
            {t("coach.budget", {
              calls: usage.calls,
              maxCalls: usage.maxCalls,
              tokens: formatNumber(usage.totalTokens),
              maxTokens: formatNumber(usage.maxTokens),
            })}
          </>
        )}
      </p>
    </div>
  );
}

function ProposalCard({ proposal: initial }: { proposal: Proposal }) {
  const { t, actionLabel, errorText } = useI18n();
  const [state, setState] = useState<"pending" | "applied" | "failed" | "partial">("pending");
  const [result, setResult] = useState<string>("");
  // issue #36: editable approval card — the user can correct AI-suggested
  // dosages/details/intervals BEFORE approving. Re-validated in applyProposal.
  const [proposal, setProposal] = useState<Proposal>(initial);

  function updateChange(i: number, patch: Partial<Proposal["changes"][number]>) {
    setProposal((p) => ({
      ...p,
      changes: p.changes.map((c, idx) => (idx === i ? ({ ...c, ...patch } as Proposal["changes"][number]) : c)),
    }));
  }

  async function apply() {
    const res = await applyProposal(proposal);
    if (res.ok && res.data) {
      const skipped = res.data.skipped;
      setState(skipped.length > 0 ? (res.data.applied.length > 0 ? "partial" : "failed") : "applied");
      setResult(
        [
          res.data.applied.length > 0 ? t("coach.appliedList", { items: res.data.applied.join("; ") }) : "",
          skipped.length > 0
            ? t("coach.skippedList", { items: skipped.map((s) => `${s.change} (${s.reason})`).join("; ") })
            : "",
        ]
          .filter(Boolean)
          .join(" · "),
      );
    } else {
      setState("failed");
      setResult(res.ok ? "" : errorText(res));
    }
  }

  return (
    <div className="mt-3 rounded-lg p-3" style={{ background: "var(--secondary)", border: "1px dashed var(--border)" }}>
      <div className="flex items-center gap-2 mb-2">
        <i aria-hidden className="ph ph-seal-check text-sm" style={{ color: "var(--accent)" }} />
        <span className="text-[10px] uppercase tracking-widest font-medium" style={{ color: "var(--accent)" }}>
          {t("coach.proposalTitle")}
        </span>
      </div>
      <textarea
        className="w-full rounded-lg px-3 py-2 text-sm mb-2 resize-none"
        style={{ background: "var(--secondary)", border: "1px solid var(--border)", color: "inherit" }}
        rows={2}
        value={proposal.rationale}
        onChange={(e) => setProposal((p) => ({ ...p, rationale: e.target.value }))}
      />
      <div className="space-y-2 mb-2">
        {proposal.changes.map((c, i) => (
          <div key={i} className="rounded-lg p-2.5 text-sm" style={{ background: "var(--secondary)" }}>
            <div className="mb-1.5" style={{ color: "var(--muted-foreground)" }}>
              {c.kind === "create"
                ? t("coach.proposalCreate", { action: actionLabel(c.actionType) })
                : t("coach.proposalAdjust", { id: c.scheduleId })}
            </div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="flex-1 text-xs" style={{ color: "var(--secondary-foreground)" }}>
                {c.kind === "adjust" ? t("coach.proposalInterval") : t("coach.proposalEvery")}
              </span>
              {c.kind === "adjust" && (
                <span className="text-xs tnum" style={{ color: "var(--faint)", textDecoration: "line-through" }}>
                  {initial.changes[i]?.intervalDays ?? c.intervalDays} d
                </span>
              )}
              <i aria-hidden className="ph ph-arrow-right text-[11px]" style={{ color: "var(--faint)" }} />
              <button type="button" onClick={() => updateChange(i, { intervalDays: Math.max(1, c.intervalDays - 1) })}
                className="rounded-[7px] text-sm font-medium"
                style={{ width: 26, height: 26, background: "transparent", boxShadow: "inset 0 0 0 1px var(--control-edge)", color: "var(--muted-foreground)", cursor: "pointer" }}>−</button>
              <span className="text-sm font-medium tnum w-7 text-center">{c.intervalDays}</span>
              <button type="button" onClick={() => updateChange(i, { intervalDays: Math.min(365, c.intervalDays + 1) })}
                className="rounded-[7px] text-sm font-medium"
                style={{ width: 26, height: 26, background: "var(--accent-soft)", boxShadow: "inset 0 0 0 1px var(--accent-edge)", color: "var(--accent-light)", cursor: "pointer" }}>+</button>
              <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>d</span>
            </div>
            {c.kind === "adjust" && initial.changes[i]?.details && initial.changes[i].details !== (c.details ?? "") && (
              <div className="flex items-center gap-2 text-xs mb-1.5">
                <span className="tnum" style={{ color: "var(--faint)", textDecoration: "line-through" }}>
                  {initial.changes[i].details}
                </span>
                <i aria-hidden className="ph ph-arrow-right text-[10px]" style={{ color: "var(--faint)" }} />
              </div>
            )}
            <input
              className="w-full rounded px-2 py-1.5 text-sm"
              style={{ background: "var(--card)", border: "1px solid var(--border)", color: "inherit" }}
              placeholder={t("coach.proposalDetailsPlaceholder")}
              defaultValue={c.details ?? ""}
              onChange={(e) => updateChange(i, { details: e.target.value || undefined })}
              maxLength={300}
            />
          </div>
        ))}
      </div>
      {state === "pending" ? (
        <button
          onClick={apply}
          className="btn-outline rounded-lg px-4 py-2 text-sm font-medium"
          style={{ minHeight: 44 }}
        >
          {t("coach.approve")}
        </button>
      ) : (
        <div className="text-sm">
          {state === "applied" && <StatusNote tone="success">{result || t("coach.applied")}</StatusNote>}
          {state === "partial" && <StatusNote tone="warning">{result}</StatusNote>}
          {state === "failed" && <StatusNote tone="error">{result || t("coach.failed")}</StatusNote>}
        </div>
      )}
    </div>
  );
}
