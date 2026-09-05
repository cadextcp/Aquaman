"use client";

/**
 * The coach prompt editor under More (docs/plan-prompt-anpassung.md §4).
 *
 * Collapsed by default so casual users are not confronted with four textareas
 * of system prompt. Per prompt: where it is used, a monospace editor,
 * variable chips that insert at the cursor, the fixed always-appended block
 * (guardrails + language) grayed out, Save/Reset — and a Test panel whose
 * results render READ-ONLY: the payload from /api/more/prompts/test carries
 * no write affordance, and this component never wires anything into
 * applyProposal.
 */

import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { useI18n } from "@/i18n/provider";
import { StatusNote } from "@/components/ui/status-note";
import { savePromptAction } from "@/app/actions";
import type { ErrorCode } from "@/lib/domain/errors";

export type PromptEditorEntry = {
  id: "coach" | "suggestions" | "planReview" | "feedingPlanDraft";
  defaultValue: string;
  value: string; // override when present, otherwise the default
  isOverride: boolean;
  variables: { name: string; required: boolean }[];
  maxChars: number;
};

type TestResult =
  | { ok: true; kind: string; usage: { promptTokens: number; completionTokens: number; costEstimateMicros: number }; answer?: string; proposal?: unknown; items?: { label: string; prompt: string }[]; verdict?: { shouldChange: boolean; summary: string; prompts: { label: string; prompt: string }[] }; plan?: string }
  | { ok: false; error: string; code: ErrorCode; vars?: Record<string, string> };

function PromptPanel({ entry, guardrails }: { entry: PromptEditorEntry; guardrails: string }) {
  const { t, errorText } = useI18n();
  const [text, setText] = useState(entry.value);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [question, setQuestion] = useState("");
  const [test, setTest] = useState<TestResult | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  const inputStyle = { background: "var(--surface)", boxShadow: "inset 0 0 0 1px var(--border)", color: "inherit" };

  async function save(textToSend: string | null) {
    if (pending) return;
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      const res = await savePromptAction(entry.id, textToSend);
      if (!res.ok) {
        setError(errorText(res));
        return;
      }
      setSaved(true);
      setDirty(false);
    } catch {
      setError(errorText({ error: "save failed", code: "prompt.saveFailed" }));
    } finally {
      setPending(false);
    }
  }

  function insertVariable(name: string) {
    const area = areaRef.current;
    const token = `{{${name}}}`;
    if (!area) {
      setText((v) => v + token);
      setDirty(true);
      return;
    }
    const start = area.selectionStart ?? area.value.length;
    const end = area.selectionEnd ?? start;
    const next = area.value.slice(0, start) + token + area.value.slice(end);
    setText(next);
    setDirty(true);
    // put the cursor after the inserted token
    requestAnimationFrame(() => {
      area.focus();
      area.setSelectionRange(start + token.length, start + token.length);
    });
  }

  async function runTest() {
    if (testing) return;
    setTesting(true);
    setTest(null);
    try {
      const res = await fetch("/api/more/prompts/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ promptId: entry.id, system: text, ...(entry.id === "coach" ? { question } : {}) }),
      });
      setTest((await res.json()) as TestResult);
    } catch {
      setTest({ ok: false, error: "unreachable", code: "prompt.aiOffline" });
    } finally {
      setTesting(false);
    }
  }

  return (
    <details className="rounded-xl p-4 edge-card">
      <summary className="cursor-pointer text-sm flex items-center gap-2 flex-wrap">
        <span className="font-medium">{t(`more.prompts.label.${entry.id}`)}</span>
        {entry.isOverride && (
          <span className="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded" style={{ background: "var(--accent-soft)", color: "var(--accent-light)" }}>
            {t("more.prompts.modified")}
          </span>
        )}
        <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>{t(`more.prompts.where.${entry.id}`)}</span>
      </summary>

      <div className="pt-4 flex flex-col gap-2">
        <textarea
          ref={areaRef}
          className="rounded-lg px-3 py-2.5 text-xs"
          style={{ ...inputStyle, minHeight: 200, resize: "vertical", fontFamily: "var(--font-mono, monospace)" }}
          value={text}
          maxLength={entry.maxChars}
          disabled={pending}
          onChange={(e) => {
            setText(e.target.value);
            setDirty(true);
            setSaved(false);
          }}
        />

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>{t("more.prompts.variables")}:</span>
          {entry.variables.length === 0 ? (
            <span className="text-xs" style={{ color: "var(--faint)" }}>{t("more.prompts.noVariables")}</span>
          ) : (
            entry.variables.map((v) => (
              <button
                key={v.name}
                type="button"
                className="rounded-full px-2.5 py-1 text-xs tnum"
                title={t(`more.prompts.var.${v.name}`)}
                disabled={pending}
                onClick={() => insertVariable(v.name)}
                style={{ background: "var(--accent-soft)", color: "var(--accent-light)", cursor: "pointer" }}
              >
                {`{{${v.name}}}`}
                {v.required ? " *" : ""}
              </button>
            ))
          )}
          <span className="text-xs ml-auto tnum" style={{ color: "var(--faint)" }}>
            {text.length}/{entry.maxChars}
          </span>
        </div>

        <details className="rounded-lg p-2.5">
          <summary className="cursor-pointer text-xs" style={{ color: "var(--muted-foreground)" }}>
            {t("more.prompts.appended")}
          </summary>
          <pre className="text-[11px] whitespace-pre-wrap mt-2 select-text" style={{ color: "var(--faint)", fontFamily: "var(--font-mono, monospace)" }}>
            {guardrails}
          </pre>
          <p className="text-xs mt-1" style={{ color: "var(--faint)" }}>{t("more.prompts.appendedNote")}</p>
        </details>

        <div className="flex items-center gap-2 flex-wrap">
          <button type="button" className="btn-outline rounded-lg px-4 py-2 text-sm font-medium" style={{ minHeight: 44 }} disabled={pending || !dirty} onClick={() => void save(text)}>
            {pending ? t("more.prompts.saving") : t("more.prompts.save")}
          </button>
          <button
            type="button"
            className="btn-ghost rounded-lg px-4 py-2 text-sm"
            style={{ minHeight: 44 }}
            disabled={pending || (!entry.isOverride && !dirty)}
            onClick={() => {
              setText(entry.defaultValue);
              setDirty(false);
              // with an override stored, reset also SAVES the removal;
              // without one it just restores the untouched default locally
              if (entry.isOverride) void save(null);
            }}
          >
            {t("more.prompts.reset")}
          </button>
          {saved && <StatusNote tone="success">{t("more.prompts.saved")}</StatusNote>}
          {error && <StatusNote tone="error">{error}</StatusNote>}
        </div>

        {/* ---- test panel: REAL model call, READ-ONLY result ---- */}
        <div className="rounded-lg p-3 mt-1" style={{ boxShadow: "inset 0 0 0 1px var(--border)" }}>
          <div className="text-xs mb-2" style={{ color: "var(--muted-foreground)" }}>
            {t("more.prompts.testIntro")}
          </div>
          {entry.id === "coach" && (
            <input
              type="text"
              className="rounded-lg px-3 py-2 text-sm mb-2 w-full"
              style={inputStyle}
              value={question}
              maxLength={2000}
              placeholder={t("more.prompts.questionPlaceholder")}
              disabled={testing}
              onChange={(e) => setQuestion(e.target.value)}
            />
          )}
          <button
            type="button"
            className="btn-outline rounded-lg px-4 py-2 text-sm font-medium"
            style={{ minHeight: 44 }}
            disabled={testing || (entry.id === "coach" && question.trim() === "")}
            onClick={() => void runTest()}
          >
            {testing ? t("more.prompts.testing") : t("more.prompts.test")}
          </button>

          {test && (
            <div className="mt-3">
              {!test.ok ? (
                <StatusNote tone="error">{errorText(test)}</StatusNote>
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded" style={{ background: "var(--accent-soft)", color: "var(--accent-light)" }}>
                      {t("more.prompts.testBadge")}
                    </span>
                    <span className="text-xs tnum" style={{ color: "var(--faint)" }}>
                      {t("more.prompts.testUsage", {
                        in: test.usage.promptTokens,
                        out: test.usage.completionTokens,
                        cost: (test.usage.costEstimateMicros / 1_000_000).toFixed(4),
                      })}
                    </span>
                  </div>
                  {test.kind === "coach" && (
                    <>
                      {test.answer && (
                        <div className="markdown text-sm">
                          <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{test.answer}</ReactMarkdown>
                        </div>
                      )}
                      {test.proposal ? (
                        <pre className="text-[11px] whitespace-pre-wrap overflow-x-auto" style={{ background: "var(--secondary)", borderRadius: 8, padding: "0.6em", fontFamily: "var(--font-mono, monospace)" }}>
                          {JSON.stringify(test.proposal, null, 2)}
                        </pre>
                      ) : (
                        <p className="text-xs" style={{ color: "var(--faint)" }}>{t("more.prompts.testNoProposal")}</p>
                      )}
                    </>
                  )}
                  {test.kind === "suggestions" && (
                    test.items && test.items.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {test.items.map((s, i) => (
                          <span key={i} className="rounded-full px-3 py-1.5 text-xs" style={{ background: "var(--accent-soft)", color: "var(--accent-light)" }}>
                            {s.label}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs" style={{ color: "var(--faint)" }}>{t("more.prompts.testNoResult")}</p>
                    )
                  )}
                  {test.kind === "planReview" && test.verdict && (
                    <div className="text-sm">
                      <p>{test.verdict.summary}</p>
                      {test.verdict.prompts.length > 0 && (
                        <ul className="text-xs mt-1" style={{ color: "var(--muted-foreground)" }}>
                          {test.verdict.prompts.map((p, i) => (
                            <li key={i}>{p.label}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                  {test.kind === "feedingPlanDraft" && (
                    test.plan ? (
                      <div className="markdown text-sm">
                        <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{test.plan}</ReactMarkdown>
                      </div>
                    ) : (
                      <p className="text-xs" style={{ color: "var(--faint)" }}>{t("more.prompts.testNoResult")}</p>
                    )
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </details>
  );
}

export function PromptEditor({
  entries,
  guardrails,
}: {
  entries: PromptEditorEntry[];
  guardrails: string;
}) {
  const { t } = useI18n();
  return (
    <details className="rounded-xl p-5 edge-card">
      <summary className="cursor-pointer text-sm font-medium flex items-center gap-2">
        <i aria-hidden className="ph ph-chat-circle-text" style={{ color: "var(--accent)" }} />
        {t("more.prompts.summary")}
      </summary>
      <div className="pt-4 flex flex-col gap-3">
        <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>{t("more.prompts.intro")}</p>
        <p className="text-xs" style={{ color: "var(--faint)" }}>{t("more.prompts.costNote")}</p>
        {entries.map((e) => (
          <PromptPanel key={e.id} entry={e} guardrails={guardrails} />
        ))}
      </div>
    </details>
  );
}
