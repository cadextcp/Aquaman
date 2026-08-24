"use client";

/**
 * AI provider settings (issue #40): provider presets (z.ai / Anthropic /
 * Kimi), custom base URL, free-text model, daily limits.
 * The API key is deliberately NOT here — it stays an env var (never DB/export).
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PROVIDER_PRESETS, type AiProviderSettingsData } from "@/lib/ai/provider-presets";

type Draft = {
  provider: AiProviderSettingsData["provider"];
  baseUrl: string;
  model: string;
  maxCallsPerDay: number;
  maxTokensPerDay: number;
};

export function AiProviderSettings({
  initial,
  envConfigured,
}: {
  initial: AiProviderSettingsData | null;
  envConfigured: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(
    initial ?? {
      provider: "zai",
      baseUrl: PROVIDER_PRESETS.zai.baseUrl,
      model: PROVIDER_PRESETS.zai.models[0],
      maxCallsPerDay: 20,
      maxTokensPerDay: 200_000,
    },
  );
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function pickProvider(p: AiProviderSettingsData["provider"]) {
    if (p === "custom") {
      setDraft((d) => ({ ...d, provider: "custom" }));
      return;
    }
    const preset = PROVIDER_PRESETS[p];
    setDraft((d) => ({ ...d, provider: p, baseUrl: preset.baseUrl, model: preset.models[0] }));
  }

  async function save() {
    setError(null);
    const res = await fetch("/api/settings/ai", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(draft),
    });
    if (res.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      startTransition(() => router.refresh());
    } else {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? "Could not save");
    }
  }

  const input = { background: "var(--secondary)", border: "1px solid var(--border)", color: "inherit" };

  return (
    <div className="rounded-xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      <div className="text-xs uppercase tracking-wide mb-2" style={{ color: "var(--muted-foreground)" }}>
        AI provider
      </div>
      {!envConfigured && (
        <p className="text-sm mb-3 rounded-lg p-2.5" style={{ background: "var(--secondary)", color: "var(--muted-foreground)" }}>
          Note: no <code>AQUAMAN_AI_API_KEY</code> in the environment — the coach stays offline until the key is set
          (env-only by design). These settings become active as soon as a key exists.
        </p>
      )}

      <div className="flex flex-wrap gap-2 mb-4">
        {(Object.keys(PROVIDER_PRESETS) as (keyof typeof PROVIDER_PRESETS)[]).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => pickProvider(p)}
            className="rounded-lg px-3 py-2 text-sm"
            style={{
              background: draft.provider === p ? "var(--primary)" : "var(--secondary)",
              color: draft.provider === p ? "var(--primary-foreground)" : "var(--secondary-foreground)",
              cursor: "pointer",
            }}
          >
            {PROVIDER_PRESETS[p].label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => pickProvider("custom")}
          className="rounded-lg px-3 py-2 text-sm"
          style={{
            background: draft.provider === "custom" ? "var(--primary)" : "var(--secondary)",
            color: draft.provider === "custom" ? "var(--primary-foreground)" : "var(--secondary-foreground)",
            cursor: "pointer",
          }}
        >
          Custom
        </button>
      </div>

      <div className="space-y-3 mb-4">
        <div>
          <label className="block text-xs uppercase tracking-wide mb-1" style={{ color: "var(--muted-foreground)" }}>
            Base URL (Anthropic-compatible)
          </label>
          <input
            className="w-full rounded-lg px-3 py-2.5 text-sm font-mono"
            style={input}
            value={draft.baseUrl}
            onChange={(e) => setDraft((d) => ({ ...d, baseUrl: e.target.value }))}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs uppercase tracking-wide mb-1" style={{ color: "var(--muted-foreground)" }}>
              Model (free text)
            </label>
            <input
              list="model-suggestions"
              className="w-full rounded-lg px-3 py-2.5 text-sm font-mono"
              style={input}
              value={draft.model}
              onChange={(e) => setDraft((d) => ({ ...d, model: e.target.value }))}
              placeholder="glm-5.3"
            />
            <datalist id="model-suggestions">
              {Object.values(PROVIDER_PRESETS).flatMap((p) => p.models).map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wide mb-1" style={{ color: "var(--muted-foreground)" }}>
              Provider
            </label>
            <div className="text-sm px-3 py-2.5 rounded-lg" style={{ background: "var(--secondary)" }}>
              {draft.provider === "custom" ? "custom endpoint" : PROVIDER_PRESETS[draft.provider].label}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs uppercase tracking-wide mb-1" style={{ color: "var(--muted-foreground)" }}>
              Max calls / day
            </label>
            <input
              type="number" min={1} max={1000}
              className="w-full rounded-lg px-3 py-2.5 text-sm"
              style={input}
              value={draft.maxCallsPerDay}
              onChange={(e) => setDraft((d) => ({ ...d, maxCallsPerDay: Number(e.target.value) }))}
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wide mb-1" style={{ color: "var(--muted-foreground)" }}>
              Max tokens / day
            </label>
            <input
              type="number" min={1000} max={10000000} step={1000}
              className="w-full rounded-lg px-3 py-2.5 text-sm"
              style={input}
              value={draft.maxTokensPerDay}
              onChange={(e) => setDraft((d) => ({ ...d, maxTokensPerDay: Number(e.target.value) }))}
            />
          </div>
        </div>
      </div>

      {error && <p className="text-sm mb-2" style={{ color: "var(--destructive)" }}>✗ {error}</p>}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-lg px-5 py-2.5 text-sm font-medium"
          style={{ background: "var(--primary)", color: "var(--primary-foreground)", minHeight: 44, cursor: "pointer" }}
        >
          Save AI settings
        </button>
        {saved && <span className="text-sm" style={{ color: "var(--success)" }}>✓ Saved</span>}
      </div>
      <p className="text-xs mt-3" style={{ color: "var(--muted-foreground)" }}>
        These settings override the environment variables. The API key itself stays in <code>AQUAMAN_AI_API_KEY</code> —
        it is never stored in the database or exports.
      </p>
    </div>
  );
}
