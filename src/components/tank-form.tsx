"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/i18n/provider";
import { createTank, updateTank, deleteTank } from "@/app/actions";
import type { TankInput } from "@/lib/schemas";
import type { Tank } from "@/lib/db/schema";

const EMPTY: TankInput = {
  name: "",
  volumeL: 60,
  waterType: "fresh",
  plants: [],
  fish: [],
  foods: [],
  hasCo2: false,
  hasHeater: true,
  hasFilter: true,
  filterType: "",
  tankState: "established",
};

export function TankForm({ tank }: { tank?: Tank }) {
  const router = useRouter();
  const { t } = useI18n();
  const editing = !!tank;
  const [form, setForm] = useState<TankInput>(
    tank
      ? {
          name: tank.name,
          volumeL: tank.volumeL,
          waterType: tank.waterType,
          plants: tank.plants,
          fish: tank.fish,
          foods: tank.foods ?? [],
          hasCo2: tank.hasCo2,
          hasHeater: tank.hasHeater,
          hasFilter: tank.hasFilter,
          filterType: tank.filterType ?? "",
          tankState: tank.tankState,
        }
      : EMPTY,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function set<K extends keyof TankInput>(key: K, value: TankInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = editing
      ? await updateTank(tank.id, { ...form, filterType: form.filterType || null })
      : await createTank({ ...form, filterType: form.filterType || null });
    if (!res.ok) {
      setError(res.error + (res.fieldErrors ? ` (${Object.values(res.fieldErrors).join(", ")})` : ""));
      return;
    }
    startTransition(() => {
      router.push("/tanks");
      router.refresh();
    });
  }

  async function handleDelete() {
    if (!tank) return;
    if (!confirm(t("tankForm.deleteConfirm", { name: tank.name }))) return;
    await deleteTank(tank.id);
    startTransition(() => {
      router.push("/tanks");
      router.refresh();
    });
  }

  const input = { background: "var(--secondary)", border: "1px solid var(--border)", color: "inherit" };
  const label = "block text-xs uppercase tracking-wide mb-1";
  const field = "w-full rounded-lg px-3 py-2.5 text-sm";

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="rounded-lg p-3 text-sm" style={{ background: "var(--destructive)", color: "#fff" }}>
          {error}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="name">{t("tankForm.name")}</label>
          <input id="name" className={field} style={input} value={form.name}
            onChange={(e) => set("name", e.target.value)} placeholder={t("tankForm.namePlaceholder")} required />
        </div>
        <div>
          <label className={label} htmlFor="volume">{t("tankForm.volume")}</label>
          <input id="volume" type="number" min={1} max={100000} className={field} style={input}
            value={form.volumeL} onChange={(e) => set("volumeL", Number(e.target.value))} required />
        </div>
        <div>
          <label className={label} htmlFor="waterType">{t("tankForm.waterType")}</label>
          <select id="waterType" className={field} style={input} value={form.waterType}
            onChange={(e) => set("waterType", e.target.value as "fresh" | "salt")}>
            <option value="fresh">{t("tanks.fresh")}</option>
            <option value="salt">{t("tanks.salt")}</option>
          </select>
        </div>
        <div>
          <label className={label} htmlFor="tankState">{t("tankForm.state")}</label>
          <select id="tankState" className={field} style={input} value={form.tankState}
            onChange={(e) => set("tankState", e.target.value as "cycling" | "established")}>
            <option value="established">{t("tankForm.established")}</option>
            <option value="cycling">{t("tankForm.cyclingOption")}</option>
          </select>
        </div>
      </div>

      <fieldset className="rounded-xl p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <legend className="text-xs uppercase tracking-wide px-2">{t("tankForm.equipment")}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {([
            ["hasFilter", t("tankForm.filter")],
            ["hasHeater", t("tankForm.heater")],
            ["hasCo2", t("tankForm.co2")],
          ] as const).map(([key, labelText]) => (
            <label key={key} className="flex items-center gap-3 text-sm py-1">
              <input type="checkbox" checked={form[key]} onChange={(e) => set(key, e.target.checked)}
                className="h-5 w-5" style={{ accentColor: "var(--primary)" }} />
              {labelText}
            </label>
          ))}
          <div>
            <input className={field} style={input} value={form.filterType ?? ""} placeholder={t("tankForm.filterTypePlaceholder")}
              onChange={(e) => set("filterType", e.target.value)} />
          </div>
        </div>
      </fieldset>

      <ListEditor
        title={t("tankForm.plants")}
        items={form.plants}
        onChange={(plants) => set("plants", plants)}
        nameKey="name"
        placeholder={t("tankForm.plantsPlaceholder")}
        addLabel={t("tankForm.addPlant")}
        removeLabel={t("tankForm.remove")}
      />
      <ListEditor
        title={t("tankForm.fish")}
        items={form.fish}
        onChange={(fish) => set("fish", fish)}
        nameKey="species"
        placeholder={t("tankForm.fishPlaceholder")}
        addLabel={t("tankForm.addFish")}
        removeLabel={t("tankForm.remove")}
      />

      {/* issue #42: food types at the tank (used by the feed plan's structured details) */}
      <FoodEditor foods={form.foods} onChange={(foods) => set("foods", foods)} />

      <div className="flex gap-3 pt-2">
        <button type="submit" disabled={pending}
          className="btn-outline rounded-lg px-5 py-2.5 text-sm font-medium"
          style={{ minHeight: 44 }}>
          {editing ? t("tanks.save") : t("tanks.create")}
        </button>
        {editing && (
          <button type="button" onClick={handleDelete} disabled={pending}
            className="rounded-lg px-5 py-2.5 text-sm"
            style={{ border: "1px solid var(--border)", minHeight: 44, color: "var(--destructive)" }}>
            {t("tanks.delete")}
          </button>
        )}
      </div>
    </form>
  );
}

function ListEditor({
  title,
  items,
  onChange,
  nameKey,
  placeholder,
  addLabel,
  removeLabel,
}: {
  title: string;
  items: { name?: string; species?: string; qty: number }[];
  onChange: (items: never[]) => void;
  nameKey: "name" | "species";
  placeholder: string;
  /** explicit, not derived from `title` — English strips a trailing "s", German cannot */
  addLabel: string;
  removeLabel: string;
}) {
  const input = { background: "var(--secondary)", border: "1px solid var(--border)", color: "inherit" };
  function update(i: number, patch: Partial<{ name: string; species: string; qty: number }>) {
    const next = items.map((it, idx) => (idx === i ? { ...it, ...patch } : it));
    onChange(next as never[]);
  }
  return (
    <fieldset className="rounded-xl p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      <legend className="text-xs uppercase tracking-wide px-2">{title}</legend>
      <div className="space-y-2">
        {items.map((it, i) => (
          <div key={i} className="flex gap-2">
            <input className="flex-1 rounded-lg px-3 py-2 text-sm" style={input}
              value={it[nameKey] ?? ""} placeholder={placeholder}
              onChange={(e) => update(i, { [nameKey]: e.target.value } as never)} />
            <input type="number" min={0} className="w-20 rounded-lg px-3 py-2 text-sm" style={input}
              value={it.qty} onChange={(e) => update(i, { qty: Number(e.target.value) })} />
            <button type="button" onClick={() => onChange(items.filter((_, idx) => idx !== i) as never[])}
              className="rounded-lg px-3" style={{ color: "var(--destructive)" }} aria-label={removeLabel}>×</button>
          </div>
        ))}
        <button type="button"
          onClick={() => onChange([...items, { [nameKey]: "", qty: 1 }] as never[])}
          className="text-sm underline" style={{ color: "var(--accent)" }}>
          {addLabel}
        </button>
      </div>
    </fieldset>
  );
}


function FoodEditor({
  foods,
  onChange,
}: {
  foods: { name: string; amount: string; unit: string }[];
  onChange: (foods: { name: string; amount: string; unit: string }[]) => void;
}) {
  const { t } = useI18n();
  const input = { background: "var(--surface)", boxShadow: "inset 0 0 0 1px var(--border)", color: "inherit" };
  const field = "rounded-lg px-2.5 py-2 text-sm";

  function update(i: number, patch: Partial<{ name: string; amount: string; unit: string }>) {
    onChange(foods.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  }

  return (
    <fieldset className="rounded-lg p-3" style={{ boxShadow: "inset 0 0 0 1px var(--border)" }}>
      <legend className="text-xs uppercase tracking-wide px-2">{t("tankForm.foods")}</legend>
      {foods.map((f, i) => (
        <div key={i} className="flex gap-1.5 mb-1.5">
          <input className={`${field} flex-1`} style={input} value={f.name} placeholder={t("tankForm.foodNamePlaceholder")}
            onChange={(e) => update(i, { name: e.target.value })} />
          <input className={`${field} w-24`} style={input} value={f.amount} placeholder={t("tankForm.foodAmountPlaceholder")}
            onChange={(e) => update(i, { amount: e.target.value })} />
          <input className={`${field} w-28`} style={input} value={f.unit} placeholder={t("tankForm.foodUnitPlaceholder")}
            onChange={(e) => update(i, { unit: e.target.value })} />
          <button type="button" onClick={() => onChange(foods.filter((_, idx) => idx !== i))}
            className="icon-btn icon-btn-sm icon-btn-danger"><i aria-hidden className="ph ph-x text-sm" /></button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...foods, { name: "", amount: "", unit: "" }])}
        className="btn-outline rounded-lg px-3 py-1.5 text-xs"
        style={{ minHeight: 36 }}
      >
        {t("tankForm.addFood")}
      </button>
    </fieldset>
  );
}
