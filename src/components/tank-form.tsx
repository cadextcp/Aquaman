"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
    if (!confirm(`Delete tank "${tank.name}"? Logs and tests are kept (soft delete).`)) return;
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
          <label className={label} htmlFor="name">Name</label>
          <input id="name" className={field} style={input} value={form.name}
            onChange={(e) => set("name", e.target.value)} placeholder="e.g. 240L Community Tank" required />
        </div>
        <div>
          <label className={label} htmlFor="volume">Volume (liters)</label>
          <input id="volume" type="number" min={1} max={100000} className={field} style={input}
            value={form.volumeL} onChange={(e) => set("volumeL", Number(e.target.value))} required />
        </div>
        <div>
          <label className={label} htmlFor="waterType">Water type</label>
          <select id="waterType" className={field} style={input} value={form.waterType}
            onChange={(e) => set("waterType", e.target.value as "fresh" | "salt")}>
            <option value="fresh">Freshwater</option>
            <option value="salt">Saltwater</option>
          </select>
        </div>
        <div>
          <label className={label} htmlFor="tankState">State</label>
          <select id="tankState" className={field} style={input} value={form.tankState}
            onChange={(e) => set("tankState", e.target.value as "cycling" | "established")}>
            <option value="established">Established</option>
            <option value="cycling">Cycling (NO₂/NH₃ peaks tolerated)</option>
          </select>
        </div>
      </div>

      <fieldset className="rounded-xl p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <legend className="text-xs uppercase tracking-wide px-2">Equipment</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {([
            ["hasFilter", "Filter"],
            ["hasHeater", "Heater"],
            ["hasCo2", "CO₂ system"],
          ] as const).map(([key, labelText]) => (
            <label key={key} className="flex items-center gap-3 text-sm py-1">
              <input type="checkbox" checked={form[key]} onChange={(e) => set(key, e.target.checked)}
                className="h-5 w-5" style={{ accentColor: "var(--primary)" }} />
              {labelText}
            </label>
          ))}
          <div>
            <input className={field} style={input} value={form.filterType ?? ""} placeholder="Filter type (optional)"
              onChange={(e) => set("filterType", e.target.value)} />
          </div>
        </div>
      </fieldset>

      <ListEditor
        title="Plants"
        items={form.plants}
        onChange={(plants) => set("plants", plants)}
        nameKey="name"
        placeholder="e.g. Vallisneria"
      />
      <ListEditor
        title="Fish"
        items={form.fish}
        onChange={(fish) => set("fish", fish)}
        nameKey="species"
        placeholder="e.g. Neon tetra"
      />

      {/* issue #42: food types at the tank (used by the feed plan's structured details) */}
      <FoodEditor foods={form.foods} onChange={(foods) => set("foods", foods)} />

      <div className="flex gap-3 pt-2">
        <button type="submit" disabled={pending}
          className="btn-outline rounded-lg px-5 py-2.5 text-sm font-medium"
          style={{ minHeight: 44 }}>
          {editing ? "Save changes" : "Create tank"}
        </button>
        {editing && (
          <button type="button" onClick={handleDelete} disabled={pending}
            className="rounded-lg px-5 py-2.5 text-sm"
            style={{ border: "1px solid var(--border)", minHeight: 44, color: "var(--destructive)" }}>
            Delete
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
}: {
  title: string;
  items: { name?: string; species?: string; qty: number }[];
  onChange: (items: never[]) => void;
  nameKey: "name" | "species";
  placeholder: string;
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
              className="rounded-lg px-3" style={{ color: "var(--destructive)" }} aria-label="remove">×</button>
          </div>
        ))}
        <button type="button"
          onClick={() => onChange([...items, { [nameKey]: "", qty: 1 }] as never[])}
          className="text-sm underline" style={{ color: "var(--accent)" }}>
          + add {title.toLowerCase().replace(/s$/, "")}
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
  const input = { background: "rgba(233,233,237,0.05)", boxShadow: "inset 0 0 0 1px var(--border)", color: "inherit" };
  const field = "rounded-lg px-2.5 py-2 text-sm";

  function update(i: number, patch: Partial<{ name: string; amount: string; unit: string }>) {
    onChange(foods.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  }

  return (
    <fieldset className="rounded-lg p-3" style={{ boxShadow: "inset 0 0 0 1px var(--border)" }}>
      <legend className="text-xs uppercase tracking-wide px-2">Foods (for the feed plan)</legend>
      {foods.map((f, i) => (
        <div key={i} className="flex gap-1.5 mb-1.5">
          <input className={`${field} flex-1`} style={input} value={f.name} placeholder="e.g. Flakes"
            onChange={(e) => update(i, { name: e.target.value })} />
          <input className={`${field} w-24`} style={input} value={f.amount} placeholder="e.g. 1"
            onChange={(e) => update(i, { amount: e.target.value })} />
          <input className={`${field} w-28`} style={input} value={f.unit} placeholder="e.g. pinch"
            onChange={(e) => update(i, { unit: e.target.value })} />
          <button type="button" onClick={() => onChange(foods.filter((_, idx) => idx !== i))}
            className="rounded-md px-2 text-sm" style={{ color: "var(--destructive)", cursor: "pointer" }}>✕</button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...foods, { name: "", amount: "", unit: "" }])}
        className="btn-outline rounded-lg px-3 py-1.5 text-xs"
        style={{ minHeight: 36 }}
      >
        + Add food
      </button>
    </fieldset>
  );
}
