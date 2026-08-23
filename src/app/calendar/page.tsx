export const dynamic = "force-dynamic";

export default function CalendarPage() {
  return (
    <main className="flex-1 pb-20 lg:pb-8 p-4 lg:p-8 max-w-3xl">
      <h1 className="text-2xl font-bold mb-6">Calendar</h1>
      <div className="rounded-xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
          In-app calendar view and the ICS feed for Google Calendar arrive in Phase 3.
        </p>
      </div>
    </main>
  );
}
