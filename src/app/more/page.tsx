import { headers } from "next/headers";
import { getOrCreateIcsToken } from "@/lib/ics-token";
import { IcsSettings } from "@/components/ics-settings";

export const dynamic = "force-dynamic";

export default async function MorePage() {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const token = getOrCreateIcsToken();
  const icsUrl = `${proto}://${host}/api/calendar.ics?t=${token}`;

  return (
    <main className="flex-1 pb-20 lg:pb-8 p-4 lg:p-8 max-w-3xl">
      <h1 className="text-2xl font-bold mb-6">More</h1>

      <div className="mb-4">
        <IcsSettings initialUrl={icsUrl} />
      </div>

      <div className="rounded-xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <p className="text-sm mb-3" style={{ color: "var(--muted-foreground)" }}>
          More features arrive in the next phases.
        </p>
        <ul className="text-sm space-y-2" style={{ color: "var(--muted-foreground)" }}>
          <li>🤖 AI coach — Phase 4</li>
          <li>⬇ Export/Import — Phase 5</li>
        </ul>
      </div>
    </main>
  );
}
