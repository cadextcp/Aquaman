"use server";

/**
 * Data import action (Phase 5 — PRD §5.9). The snapshot arrives as untrusted
 * client input: zod-validated + reference-checked + transacted inside
 * importSnapshot(). The UI double-confirms (file selected + explicit
 * "replace everything" confirm) — the destructive nature is on the user.
 */

import { revalidatePath } from "next/cache";
import { failure } from "@/lib/domain/errors";
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
    // the thrown message carries the detail (which row, which field) — the
    // catalog line frames it, so both survive translation
    const detail = err instanceof Error ? err.message : "";
    return failure("import.failed", detail || "Import failed — nothing was changed", { detail });
  }
}
