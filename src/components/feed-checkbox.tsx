"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { markFedToday } from "@/app/actions";

/** One-tap feeding checkbox (daily habit, feed_logs — never an ICS event). */
export function FeedCheckbox({
  tankId,
  tankName,
  checked,
  timesFed,
}: {
  tankId: number;
  tankName: string;
  checked: boolean;
  timesFed: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  async function tap() {
    await markFedToday(tankId);
    startTransition(() => router.refresh());
  }

  return (
    <button onClick={tap} disabled={pending}
      className="rounded-lg px-4 py-2.5 text-sm font-medium flex items-center gap-2"
      style={{
        minHeight: 44,
        background: checked ? "var(--primary)" : "var(--secondary)",
        color: checked ? "var(--primary-foreground)" : "var(--secondary-foreground)",
      }}>
      <span aria-hidden>{checked ? "🐟" : "🍽"}</span>
      {tankName}
      {timesFed > 1 && <span className="text-xs opacity-80">×{timesFed}</span>}
    </button>
  );
}
