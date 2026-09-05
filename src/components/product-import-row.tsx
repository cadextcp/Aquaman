"use client";

/**
 * The import row above the "add product" form
 * (docs/plan-produkt-import-url.md §2, photo mode §10 stage 3).
 *
 * Three sources, one contract: a photo of the label (the default — the bottle
 * is usually in the hand while the shelf is where the typing happens), a link
 * to a shop page, and pasted text as the fallback when both fail.
 *
 * It only ever fills the form fields in — saving stays the user's press on the
 * form's own button. That is why this component takes an `onDraft` callback
 * and owns no product state of its own: the approval gate is the form, and a
 * second write path would quietly remove it.
 *
 * Rendered only when creating a product, never when editing (plan §2): a model
 * call must not be able to overwrite text a person typed.
 */

import { useRef, useState } from "react";
import { useI18n } from "@/i18n/provider";
import { StatusNote } from "@/components/ui/status-note";
import type { ErrorCode } from "@/lib/domain/errors";

export type ImportedDraft = {
  name: string;
  description: string | null;
  defaultDose: string | null;
  nutrients: Record<string, string>;
  /** Set only on the URL path — photo and pasted text have no verifiable source. */
  sourceUrl?: string | null;
};

/** Failures that a pasted page text can still get around — §7 of the plan. */
const PASTE_HELPS: ReadonlySet<string> = new Set([
  "productImport.blocked",
  "productImport.unreachable",
  "productImport.tooThin",
  "productImport.notHtml",
]);

/** Mirrors MAX_INPUT_BYTES in lib/import/prepare-image.ts — fail before uploading. */
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/** Chunked btoa — String.fromCharCode on a whole multi-MB photo overflows the call stack. */
async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

type ImportMode = "photo" | "url" | "paste";

export function ProductImportRow({
  kind,
  onDraft,
}: {
  kind: "fertilizer" | "food";
  onDraft: (draft: ImportedDraft) => void;
}) {
  const { t, errorText } = useI18n();
  const [mode, setMode] = useState<ImportMode>("photo");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [filled, setFilled] = useState(false);
  const [offerPaste, setOfferPaste] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const inputStyle = { background: "var(--surface)", boxShadow: "inset 0 0 0 1px var(--border)", color: "inherit" };

  const modeLabel: Record<ImportMode, string> = {
    photo: t("inventory.importModePhoto"),
    url: t("inventory.importModeUrl"),
    paste: t("inventory.importModeText"),
  };
  const modeHint: Record<ImportMode, string> = {
    photo: t("inventory.importPhotoHint"),
    url: t("inventory.importHint"),
    paste: t("inventory.importPasteHint"),
  };

  async function run() {
    if (pending) return;
    if (mode === "url" && url.trim() === "") return;
    if (mode === "paste" && text.trim() === "") return;
    if (mode === "photo" && !photo) return;

    setPending(true);
    setError(null);
    setNotes([]);
    setFilled(false);
    setOfferPaste(false);
    try {
      let body: Record<string, unknown>;
      if (mode === "url") {
        body = { kind, url };
      } else if (mode === "paste") {
        body = { kind, text };
      } else {
        const file = photo;
        if (!file) return;
        if (file.size > MAX_PHOTO_BYTES) {
          setError(errorText({ error: "photo exceeds 5 MB", code: "productImport.imageTooLarge" }));
          return;
        }
        body = { kind, imageBase64: await fileToBase64(file) };
      }

      const res = await fetch("/api/inventory/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as
        | { ok: true; draft: ImportedDraft; notes: string[]; sourceUrl?: string }
        | { ok: false; error: string; code: ErrorCode };

      if (!json.ok) {
        setError(errorText(json));
        // Only a network-shaped refusal is worth answering with "paste it
        // instead" — a blocked LAN address is not a fetching problem.
        setOfferPaste(mode === "url" && PASTE_HELPS.has(json.code));
        return;
      }
      onDraft({ ...json.draft, sourceUrl: json.sourceUrl ?? null });
      setNotes(json.notes);
      setFilled(true);
    } catch {
      setError(errorText({ error: "unreachable", code: "productImport.unreachable" }));
      setOfferPaste(mode === "url");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rounded-lg p-3 mb-1" style={{ boxShadow: "inset 0 0 0 1px var(--border)" }}>
      <div className="text-xs uppercase tracking-wide mb-2" style={{ color: "var(--muted-foreground)" }}>
        {t("inventory.importTitle")}
      </div>

      <div className="flex gap-1 mb-2" role="tablist" aria-label={t("inventory.importTitle")}>
        {(["photo", "url", "paste"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            className={`rounded-lg px-3 py-1.5 text-xs ${mode === m ? "btn-outline font-medium" : ""}`}
            style={mode === m ? undefined : { color: "var(--muted-foreground)" }}
            disabled={pending}
            onClick={() => {
              setMode(m);
              setError(null);
              setOfferPaste(false);
            }}
          >
            {modeLabel[m]}
          </button>
        ))}
      </div>

      {mode === "photo" && (
        <div className="flex flex-col gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            disabled={pending}
            onChange={(e) => {
              setPhoto(e.target.files?.[0] ?? null);
              setError(null);
            }}
          />
          <button
            type="button"
            className="btn-outline rounded-lg px-4 py-2 text-sm font-medium self-start max-w-full"
            style={{ minHeight: 44 }}
            disabled={pending}
            onClick={() => fileInputRef.current?.click()}
          >
            <span className="block truncate">{photo ? photo.name : t("inventory.importPhotoChoose")}</span>
          </button>
          <button
            type="button"
            className="btn-outline rounded-lg px-4 py-2 text-sm font-medium self-start"
            style={{ minHeight: 44 }}
            disabled={pending || !photo}
            onClick={() => void run()}
          >
            {pending ? t("inventory.importPhotoPending") : t("inventory.importPhotoAction")}
          </button>
        </div>
      )}

      {mode === "url" && (
        <div className="flex gap-2">
          <input
            type="url"
            inputMode="url"
            className="rounded-lg px-3 py-2.5 text-sm flex-1 min-w-0"
            style={inputStyle}
            value={url}
            maxLength={2048}
            placeholder={t("inventory.importPlaceholder")}
            disabled={pending}
            onChange={(e) => setUrl(e.target.value)}
            // Enter inside the product form would submit the form and save an
            // empty product; keep it on this row.
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void run();
              }
            }}
          />
          <button
            type="button"
            className="btn-outline rounded-lg px-4 text-sm font-medium shrink-0"
            style={{ minHeight: 44 }}
            disabled={pending || url.trim() === ""}
            onClick={() => void run()}
          >
            {pending ? t("inventory.importPending") : t("inventory.importFetch")}
          </button>
        </div>
      )}

      {mode === "paste" && (
        <div className="flex flex-col gap-2">
          <textarea
            className="rounded-lg px-3 py-2.5 text-sm"
            style={{ ...inputStyle, minHeight: 96, resize: "vertical" }}
            value={text}
            maxLength={50000}
            placeholder={t("inventory.importPastePlaceholder")}
            disabled={pending}
            onChange={(e) => setText(e.target.value)}
          />
          <button
            type="button"
            className="btn-outline rounded-lg px-4 py-2 text-sm font-medium self-start"
            style={{ minHeight: 44 }}
            disabled={pending || text.trim() === ""}
            onClick={() => void run()}
          >
            {pending ? t("inventory.importPending") : t("inventory.importPasteAction")}
          </button>
        </div>
      )}

      <div className="flex items-baseline justify-between gap-3 mt-2">
        <p className="text-xs" style={{ color: "var(--faint)" }}>
          {modeHint[mode]}
        </p>
        {mode === "url" && (
          <button
            type="button"
            className="text-xs underline shrink-0"
            style={{ color: "var(--muted-foreground)" }}
            onClick={() => {
              setMode("paste");
              setError(null);
              setOfferPaste(false);
            }}
          >
            {t("inventory.importModeText")}
          </button>
        )}
      </div>

      {error && (
        <div className="mt-2">
          <StatusNote tone="error">
            {error}
            {offerPaste && (
              <>
                {" "}
                <button type="button" className="underline" onClick={() => { setMode("paste"); setError(null); setOfferPaste(false); }}>
                  {t("inventory.importModeText")}
                </button>
              </>
            )}
          </StatusNote>
        </div>
      )}

      {filled && (
        <div className="mt-2">
          <StatusNote tone="success">{t("inventory.importFilled")}</StatusNote>
        </div>
      )}

      {/* What the source did NOT say. The honest half of the feature: it tells
          the user which field they still have to fill from the package. */}
      {notes.length > 0 && (
        <p className="text-xs mt-2" style={{ color: "var(--muted-foreground)" }}>
          {t("inventory.importNotFound")} {notes.join(" · ")}
        </p>
      )}
    </div>
  );
}
