export default function MorePage() {
  return (
    <main className="flex-1 pb-20 lg:pb-8 p-4 lg:p-8 max-w-3xl">
      <h1 className="text-2xl font-bold mb-6">More</h1>
      <div className="rounded-xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <p className="text-sm mb-3" style={{ color: "var(--muted-foreground)" }}>
          Settings, AI coach and calendar follow in the next phases.
        </p>
        <ul className="text-sm space-y-2" style={{ color: "var(--muted-foreground)" }}>
          <li>📡 ICS feed — Phase 3</li>
          <li>🤖 AI coach — Phase 4</li>
          <li>⬇ Export/Import — Phase 5</li>
        </ul>
      </div>
    </main>
  );
}
