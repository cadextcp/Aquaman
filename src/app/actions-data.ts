"use server";

/**
 * Data import action (Phase 5 — PRD §5.9). The snapshot arrives as untrusted
 * client input: zod-validated + reference-checked + transacted inside
 * importSnapshot(). The UI double-confirms (file selected + explicit
 * "replace everything" confirm) — the destructive nature is on the user.
 */

import { revalidatePath } from "next/cache";
import { importSnapshot } from "@/lib/export";
import type { ActionResult } from "./actions";

export type ImportSummary = {
  tanks: number;
  schedules: number;
  maintenanceLogs: number;
  waterTests: number;
  feedLogs: number;
  aiCalls: number;
};

export async function importDataAction(input: unknown): Promise<ActionResult<ImportSummary>> {
  try {
    const result = importSnapshot(input);
    revalidatePath("/");
    revalidatePath("/tanks");
    revalidatePath("/calendar");
    revalidatePath("/coach");
    revalidatePath("/more");
    return { ok: true, data: result };
  } catch (err) {
    console.error("[importDataAction]", err);
    return { ok: false, error: err instanceof Error ? err.message : "Import failed — nothing was changed" };
  }
}
