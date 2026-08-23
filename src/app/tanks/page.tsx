import Link from "next/link";
import { listTanks } from "@/lib/repo";

export const dynamic = "force-dynamic";

export default async function TanksPage() {
  const tanks = listTanks();

  return (
    <main className="flex-1 pb-20 lg:pb-8 p-4 lg:p-8 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Tanks</h1>
        <Link href="/tanks/new" className="rounded-lg px-4 py-2.5 text-sm font-medium"
          style={{ background: "var(--primary)", color: "var(--primary-foreground)", minHeight: 44 }}>
          + New tank
        </Link>
      </div>

      {tanks.length === 0 ? (
        <div className="rounded-xl p-8 text-center" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <p className="mb-4" style={{ color: "var(--muted-foreground)" }}>No tanks yet — create your first tank.</p>
          <Link href="/tanks/new" className="underline" style={{ color: "var(--accent)" }}>
            Create tank →
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {tanks.map((t) => (
            <Link key={t.id} href={`/tanks/${t.id}`}
              className="rounded-xl p-4 block"
              style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold">{t.name}</div>
                  <div className="text-sm" style={{ color: "var(--muted-foreground)" }}>
                    {t.volumeL} L · {t.waterType === "fresh" ? "Freshwater" : "Saltwater"}
                    {t.tankState === "cycling" ? " · cycling" : ""}
                  </div>
                </div>
                {t.hasCo2 && (
                  <span className="rounded-full px-2 py-0.5 text-xs"
                    style={{ background: "var(--secondary)", color: "var(--secondary-foreground)" }}>CO₂</span>
                )}
              </div>
              {(t.fish.length > 0 || t.plants.length > 0) && (
                <div className="mt-2 text-xs" style={{ color: "var(--muted-foreground)" }}>
                  {t.fish.reduce((a, f) => a + f.qty, 0)} fish · {t.plants.length} plant species
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
