"use client";

/**
 * One section of the virtual shelf — fertilizers or foods
 * (docs/plan-produkt-lager.md). List plus an inline create/edit form, the
 * same `<details>`-style expansion the rest of the app uses instead of a
 * modal, so the phone keyboard never covers the thing being edited.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/i18n/provider";
import { createProduct, updateProduct, deleteProduct } from "@/app/actions";
import { NUTRIENTS } from "@/lib/domain/plan-structure";
import { plansUsingProduct } from "@/lib/domain/inventory";
import type { Product } from "@/lib/db/schema";
import { StatusNote } from "./ui/status-note";

type Kind = "fertilizer" | "food";

/** Mirrors productInputSchema — the same limits, so the form cannot submit what zod rejects. */
const MAX_NAME = 80;
const MAX_DESCRIPTION = 600;
const MAX_DOSE = 30;
const MAX_CONTENT = 30;

export function InventorySection({
  kind,
  products,
  fertilizePlans = [],
}: {
  kind: Kind;
  products: Product[];
  /** nutrients of every active fertilize plan — drives the "used in N plans" line */
  fertilizePlans?: (Record<string, unknown> | null)[];
}) {
  const { t } = useI18n();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  return (
    <section className="mb-6">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-lg font-semibold">
          {kind === "fertilizer" ? t("inventory.fertilizers") : t("inventory.foods")}
          <span className="ml-2 text-sm font-normal tnum" style={{ color: "var(--faint)" }}>
            {products.length}
          </span>
        </h2>
        {!adding && (
          <button
            type="button"
            onClick={() => {
              setAdding(true);
              setEditingId(null);
            }}
            className="btn-outline rounded-lg px-3 py-2 text-sm"
            style={{ minHeight: 44 }}
          >
            {kind === "fertilizer" ? t("inventory.addFertilizer") : t("inventory.addFood")}
          </button>
        )}
      </div>

      {adding && (
        <div className="rounded-xl p-4 mb-3 edge-card">
          <ProductForm kind={kind} onDone={() => setAdding(false)} />
        </div>
      )}

      {products.length === 0 && !adding && (
        <p className="text-sm rounded-xl p-4 edge-card" style={{ color: "var(--muted-foreground)" }}>
          {kind === "fertilizer" ? t("inventory.emptyFertilizers") : t("inventory.emptyFoods")}
        </p>
      )}

      <div className="flex flex-col gap-2">
        {products.map((p) =>
          editingId === p.id ? (
            <div key={p.id} className="rounded-xl p-4 edge-card">
              <ProductForm kind={kind} product={p} onDone={() => setEditingId(null)} />
            </div>
          ) : (
            <ProductCard key={p.id} product={p} fertilizePlans={fertilizePlans} onEdit={() => setEditingId(p.id)} />
          ),
        )}
      </div>
    </section>
  );
}

function ProductCard({
  product,
  fertilizePlans,
  onEdit,
}: {
  product: Product;
  fertilizePlans: (Record<string, unknown> | null)[];
  onEdit: () => void;
}) {
  const router = useRouter();
  const { t, plural, nutrientLabel, errorText } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const keys = Object.keys(product.nutrients ?? {});
  const usedInPlans = plansUsingProduct(
    { id: product.id, name: product.name, nutrients: (product.nutrients ?? {}) as Record<string, string> },
    fertilizePlans,
  );

  async function handleDelete() {
    if (!confirm(t("inventory.deleteConfirm", { name: product.name }))) return;
    const res = await deleteProduct(product.id);
    if (!res.ok) {
      setError(errorText(res));
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <div className="rounded-xl p-4 edge-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">{product.name}</div>
          {product.defaultDose && (
            <div className="text-xs tnum mt-0.5" style={{ color: "var(--faint)" }}>
              {product.defaultDose}
            </div>
          )}
        </div>
        <div className="shrink-0 flex items-center gap-1.5">
          <button type="button" onClick={onEdit} className="icon-btn icon-btn-sm" aria-label={t("inventory.edit", { name: product.name })}>
            <i aria-hidden className="ph ph-pencil-simple text-sm" />
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={pending}
            className="icon-btn icon-btn-sm icon-btn-danger"
            aria-label={t("inventory.delete", { name: product.name })}
          >
            <i aria-hidden className="ph ph-trash text-sm" />
          </button>
        </div>
      </div>

      {product.kind === "fertilizer" && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {keys.length === 0 ? (
            <span className="text-xs" style={{ color: "var(--faint)" }}>
              {t("inventory.noNutrients")}
            </span>
          ) : (
            keys.map((k) => {
              const n = NUTRIENTS.find((x) => x.key === k);
              const content = (product.nutrients as Record<string, string>)[k];
              return (
                <span
                  key={k}
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px]"
                  style={{ background: "var(--accent-soft)", color: "var(--foreground)" }}
                  title={nutrientLabel(k, n?.label ?? k)}
                >
                  <span className="font-medium">{n?.symbol ?? k}</span>
                  {content && <span style={{ color: "var(--muted-foreground)" }}>{content}</span>}
                </span>
              );
            })
          )}
        </div>
      )}

      {product.kind === "fertilizer" && keys.length > 0 && (
        <div className="text-xs mt-1.5" style={{ color: usedInPlans === 0 ? "var(--warning)" : "var(--faint)" }}>
          {usedInPlans === 0 ? t("inventory.usedInNoPlan") : plural("inventory.usedInPlans", usedInPlans)}
        </div>
      )}

      {product.description && (
        <p className="text-xs mt-2 whitespace-pre-line" style={{ color: "var(--muted-foreground)" }}>
          {product.description}
        </p>
      )}
      {error && (
        <div className="mt-2">
          <StatusNote tone="error">{error}</StatusNote>
        </div>
      )}
    </div>
  );
}

function ProductForm({ kind, product, onDone }: { kind: Kind; product?: Product; onDone: () => void }) {
  const router = useRouter();
  const { t, plural, nutrientLabel, errorText } = useI18n();
  const [name, setName] = useState(product?.name ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [defaultDose, setDefaultDose] = useState(product?.defaultDose ?? "");
  const [nutrients, setNutrients] = useState<Record<string, string>>(
    (product?.nutrients as Record<string, string> | undefined) ?? {},
  );
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggleNutrient(key: string) {
    setNutrients((cur) => {
      if (key in cur) {
        const next = { ...cur };
        delete next[key];
        return next;
      }
      // "" is a legitimate value: contained, no content declared.
      return { ...cur, [key]: "" };
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNote(null);
    const input = {
      kind,
      name,
      description: description.trim() || null,
      defaultDose: defaultDose.trim() || null,
      nutrients: kind === "fertilizer" ? nutrients : {},
    };
    const res = product ? await updateProduct(product.id, input) : await createProduct(input);
    if (!res.ok) {
      setError(errorText(res));
      return;
    }
    // Renaming re-keys the food in active plans — say so rather than letting
    // the user wonder whether their feeding plan still points anywhere.
    const renamed = product && "data" in res ? (res.data as { renamedPlans?: number } | undefined)?.renamedPlans ?? 0 : 0;
    if (renamed > 0) setNote(plural("inventory.renamedPlans", renamed));
    startTransition(() => router.refresh());
    if (renamed === 0) onDone();
  }

  const inputStyle = { background: "var(--surface)", boxShadow: "inset 0 0 0 1px var(--border)", color: "inherit" };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs uppercase tracking-wide" style={{ color: "var(--muted-foreground)" }}>
          {t("inventory.name")}
        </span>
        <input
          className="rounded-lg px-3 py-2.5 text-sm"
          style={inputStyle}
          value={name}
          maxLength={MAX_NAME}
          required
          placeholder={kind === "fertilizer" ? t("inventory.namePlaceholderFertilizer") : t("inventory.namePlaceholderFood")}
          onChange={(e) => setName(e.target.value)}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs uppercase tracking-wide" style={{ color: "var(--muted-foreground)" }}>
          {t("inventory.description")}
        </span>
        <textarea
          className="rounded-lg px-3 py-2.5 text-sm"
          style={{ ...inputStyle, minHeight: 88, resize: "vertical" }}
          value={description}
          maxLength={MAX_DESCRIPTION}
          placeholder={kind === "fertilizer" ? t("inventory.descriptionPlaceholderFertilizer") : t("inventory.descriptionPlaceholderFood")}
          onChange={(e) => setDescription(e.target.value)}
        />
        <span className="text-xs" style={{ color: "var(--faint)" }}>
          {t("inventory.descriptionHint")}
        </span>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs uppercase tracking-wide" style={{ color: "var(--muted-foreground)" }}>
          {t("inventory.defaultDose")}
        </span>
        <input
          className="rounded-lg px-3 py-2.5 text-sm w-40"
          style={inputStyle}
          value={defaultDose}
          maxLength={MAX_DOSE}
          placeholder={kind === "fertilizer" ? t("inventory.defaultDosePlaceholderFertilizer") : t("inventory.defaultDosePlaceholderFood")}
          onChange={(e) => setDefaultDose(e.target.value)}
        />
      </label>

      {kind === "fertilizer" && (
        <fieldset className="rounded-lg p-3" style={{ boxShadow: "inset 0 0 0 1px var(--border)" }}>
          <legend className="text-xs uppercase tracking-wide px-2">{t("inventory.nutrients")}</legend>
          <p className="text-xs mb-2" style={{ color: "var(--faint)" }}>
            {t("inventory.nutrientsHint")}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
            {NUTRIENTS.map((n) => {
              const on = n.key in nutrients;
              return (
                <div key={n.key} className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 w-20 shrink-0 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggleNutrient(n.key)}
                      style={{ accentColor: "var(--accent)" }}
                      aria-label={nutrientLabel(n.key, n.label)}
                    />
                    <span
                      className="font-medium"
                      style={{ color: n.group === "macro" ? "var(--secondary-foreground)" : "var(--muted-foreground)" }}
                    >
                      {n.symbol}
                    </span>
                  </label>
                  <input
                    className="flex-1 min-w-0 rounded-md px-2 py-1.5 text-xs"
                    style={{ ...inputStyle, opacity: on ? 1 : 0.4 }}
                    disabled={!on}
                    maxLength={MAX_CONTENT}
                    placeholder={t("inventory.contentPlaceholder")}
                    value={nutrients[n.key] ?? ""}
                    onChange={(e) => setNutrients((cur) => ({ ...cur, [n.key]: e.target.value }))}
                  />
                </div>
              );
            })}
          </div>
        </fieldset>
      )}

      {error && <StatusNote tone="error">{error}</StatusNote>}
      {note && <StatusNote tone="info">{note}</StatusNote>}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="btn-outline rounded-lg px-5 py-2.5 text-sm font-medium" style={{ minHeight: 44 }}>
          {product ? t("tanks.save") : t("common.save")}
        </button>
        <button type="button" onClick={onDone} className="btn-outline rounded-lg px-4 py-2.5 text-sm" style={{ minHeight: 44 }}>
          {t("common.cancel")}
        </button>
      </div>
    </form>
  );
}
