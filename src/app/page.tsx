import { BottomNav, SideNav } from "@/components/nav";

export default function Home() {
  return (
    <div className="flex min-h-dvh">
      <SideNav />
      <main className="flex-1 pb-20 lg:pb-8 p-4 lg:p-8 max-w-3xl">
        <div className="aqua-gradient rounded-2xl p-6 mb-6" style={{ border: "1px solid var(--border)" }}>
          <h1 className="text-2xl font-bold mb-1">🌊 Aquaman</h1>
          <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
            Self-hosted aquarium care — Phase 1 vertical slice is live.
          </p>
          <div className="flex flex-wrap gap-2 mt-4 text-xs">
            <span
              className="rounded-full px-3 py-1"
              style={{ background: "var(--secondary)", color: "var(--secondary-foreground)" }}
            >
              Next.js 15 · React 19
            </span>
            <span
              className="rounded-full px-3 py-1"
              style={{ background: "var(--secondary)", color: "var(--secondary-foreground)" }}
            >
              SQLite · Drizzle
            </span>
            <span
              className="rounded-full px-3 py-1"
              style={{ background: "var(--secondary)", color: "var(--secondary-foreground)" }}
            >
              41 domain tests green
            </span>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <div className="text-xs uppercase tracking-wide mb-2" style={{ color: "var(--muted-foreground)" }}>
              Foundation checks
            </div>
            <ul className="text-sm space-y-1.5">
              <li>
                <a href="/api/health" className="underline" style={{ color: "var(--accent)" }}>
                  /api/health
                </a>{" "}
                — health + DB ping
              </li>
              <li>
                <a href="/api/dbcheck" className="underline" style={{ color: "var(--accent)" }}>
                  /api/dbcheck
                </a>{" "}
                — schema tables present
              </li>
            </ul>
          </div>
          <div className="rounded-xl p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <div className="text-xs uppercase tracking-wide mb-2" style={{ color: "var(--muted-foreground)" }}>
              Coming in Phase 2
            </div>
            <ul className="text-sm space-y-1.5" style={{ color: "var(--muted-foreground)" }}>
              <li>Tank management + photos</li>
              <li>Schedules, snooze, auto-reschedule UI</li>
              <li>Water tests + charts</li>
            </ul>
          </div>
        </div>
      </main>
      <BottomNav />
    </div>
  );
}
