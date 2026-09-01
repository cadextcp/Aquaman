/**
 * Coach context builder (Phase 4 — TechDesign §4.5, §8 "Modell-sichtbare Daten").
 *
 * Assembles exactly what the PRD allows the model to see: tank profiles
 * (incl. tankState), the last 10 water tests incl. calculated NH3, backlog
 * (originalDueAt-based overdueDays), missedSlots, open tasks. NEVER tokens,
 * keys or .env contents (AGENTS "Never send").
 *
 * Pure-ish: reads via repo, formats to compact JSON-ish text. Kept separate
 * from the client so tests can pin the data boundary (what is/isn't included).
 */

import { listTanks, listSchedules, waterTestsForTank } from "@/lib/repo";
import { nextDue, missedSlots } from "@/lib/domain/scheduler";
import { evaluateWaterTest, FRESHWATER_RANGES, SALTWATER_RANGES, nh3FromNh4 } from "@/lib/domain/ranges";
import { today } from "@/lib/domain/dates";
import { SCHEDULABLE_ACTION_TYPES } from "@/lib/domain/action-types";

export const COACH_SYSTEM_PROMPT = `You are Aquaman, a calm and friendly aquarium care coach.

What you do:
- Answer care questions using the provided tank context only. You see the user's tanks, water tests (including calculated free ammonia NH3), maintenance backlog and feeding history.
- Recommend practical steps: water changes, cleaning, testing cadence, observation.
- When asked (or when values warrant it), propose schedule changes via the propose_schedule tool. Proposals are drafts — the user must approve them before anything is saved.
- Include CONCRETE details in schedule proposals when helpful: water-change liters (e.g. "30 L of 60 L (50 %)") and fertilizer type + amount (e.g. "10 ml iron fertilizer"). ALWAYS append a warning to verify the dosage against the product label — your dosage information may be wrong. NEVER propose medication dosages (point to a specialist retailer/vet instead).

Rules:
- Recommendations only, never medication dosages. Point to a specialist retailer/vet for disease or medication questions.
- Free ammonia (NH3), not raw ammonium (NH4), decides the ammonia verdict. NH3 above ~0.02 mg/l is critical for fish.
- NO2 above 0 in an established tank is a warning; NO2/NH3 peaks are EXPECTED while a tank is cycling — reassure instead of alarming.
- If a tank's context lists "fish: NONE", it has NO fish. Do NOT suggest feeding, a feeding plan, or any livestock-dependent care for it (it is a plants-only tank). Fertilization, water changes and testing still apply.
- Be encouraging about backlog. The user had a busy week? Suggest focusing on the single most important task first (usually a water change). Never scold.
- Use the missedSlots context to consider suggesting a longer interval when a task repeatedly misses (>= 3).
- Answer in the user's language (default English).
- You have NO ability to write data. Never claim an action as done. Never fabricate measurements or logs.
- Today's date is given in the context. All dates are YYYY-MM-DD.

propose_schedule contract (violations are rejected by the app — the user sees nothing):
- EVERY change includes kind and intervalDays. kind=create ALSO needs tankId, actionType, preferredDays. kind=adjust ALSO needs scheduleId (never tankId/actionType there). Never omit a required field, never send an empty changes array.
- actionType is exactly one of: ${SCHEDULABLE_ACTION_TYPES.join(", ")} — no other values, no custom labels.
- preferredDays is the 7-bit weekday mask (bit0=Mon … bit6=Sun); use 127 when the user names no weekdays.
- ALWAYS also write a short visible summary of the proposal — never let a tool call be your entire answer, and never return an empty answer (if you cannot help, say so in text).`;

/**
 * Context block appended to the system prompt (data the model may see).
 * `tankId` scopes the coach to ONE tank (dashboard/calendar filter, extended
 * to the coach): the model receives ONLY that tank's data, so it structurally
 * cannot answer about or propose plans for any other tank — no other tank
 * exists in the text it's given at all.
 */
export function buildCoachContext(now: Date = new Date(), tz?: string, tankId?: number): string {
  const t = today(tz, now);
  const lines: string[] = [];
  lines.push(`TODAY: ${t}`);

  const allTanks = listTanks();
  const tanks = tankId !== undefined ? allTanks.filter((tk) => tk.id === tankId) : allTanks;
  if (tankId !== undefined) {
    lines.push("SCOPE: The user selected exactly this ONE tank below — it is the only tank in view. Never mention, compare to, or assume any other tank exists.");
  }
  if (tanks.length === 0) {
    lines.push("TANKS: (none set up yet)");
    return lines.join("\n");
  }

  for (const tank of tanks) {
    lines.push(
      `TANK #${tank.id} "${tank.name}": ${tank.volumeL}L ${tank.waterType === "fresh" ? "freshwater" : "saltwater"}, ${tank.tankState}` +
        (tank.hasCo2 ? ", CO2" : "") +
        (tank.hasHeater ? ", heater" : "") +
        (tank.hasFilter ? `, filter${tank.filterType ? ` (${tank.filterType})` : ""}` : ""),
    );
    // Livestock is ALWAYS stated explicitly — an omitted line let the model
    // assume fish and suggest feeding for fishless (plants-only) tanks.
    if (tank.fish.length > 0) {
      lines.push(`  fish: ${tank.fish.map((f) => `${f.species} x${f.qty}`).join(", ")}`);
    } else {
      lines.push(`  fish: NONE (no livestock in this tank — plants-only; do NOT suggest feeding or livestock-dependent care)`);
    }
    if (tank.plants.length > 0) {
      lines.push(`  plants: ${tank.plants.map((p) => `${p.name} x${p.qty}`).join(", ")}`);
    } else {
      lines.push("  plants: none");
    }

    // last 10 water tests, newest first, incl. calculated NH3
    const tests = waterTestsForTank(tank.id, 365);
    const recent = tests.slice(0, 10);
    if (recent.length > 0) {
      lines.push(`  water tests (last ${recent.length}, newest first):`);
      for (const wt of recent) {
        const vals = Object.entries(wt.values)
          .filter(([, v]) => v !== null)
          .map(([k, v]) => `${k}=${v}`)
          .join(" ");
        let nh3Note = "";
        const nh4 = wt.values["nh4"];
        const ph = wt.values["ph"];
        const temp = wt.values["temp"];
        if (typeof nh4 === "number" && typeof ph === "number" && typeof temp === "number") {
          const nh3 = nh3FromNh4(nh4, ph, temp);
          nh3Note = ` [NH3_calc=${nh3.toFixed(4)} mg/l]`;
        }
        lines.push(`    ${wt.measuredAt.slice(0, 10)} ${vals}${nh3Note}`);
      }
      // evaluated verdicts of the newest test (incl. cycling tolerance)
      const ranges = tank.waterType === "salt" ? SALTWATER_RANGES : FRESHWATER_RANGES;
      const evaluation = evaluateWaterTest(recent[0].values, ranges, {
        ph: recent[0].values["ph"] ?? null,
        temp: recent[0].values["temp"] ?? null,
        tankState: tank.tankState,
      });
      const problems = evaluation.filter((e) => e.status !== "ok");
      if (problems.length > 0) {
        lines.push(
          `  latest verdicts: ${problems.map((p) => `${p.key} ${p.value} (${p.status})`).join("; ")}`,
        );
      } else {
        lines.push("  latest verdicts: all measured values in range");
      }
    } else {
      lines.push("  water tests: none recorded");
    }

    // schedules + backlog
    const schedules = listSchedules(tank.id);
    if (schedules.length > 0) {
      lines.push("  schedules:");
      for (const s of schedules) {
        const due = nextDue(s, now, tz);
        const missed = missedSlots(s, now, tz);
        const mask = [...Array(7).keys()]
          .filter((i) => (s.preferredDays >> i) & 1)
          .map((i) => ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][i])
          .join("/");
        lines.push(
          `    #${s.id} ${s.actionType} every ${s.intervalDays}d [${mask}]` +
            ` → planned ${due.plannedFor} (original due ${due.originalDueAt}, ${due.overdueDays}d behind, missedSlots ${missed})` +
            (s.lastDoneAt ? `, last done ${s.lastDoneAt.slice(0, 10)}` : ", never done"),
        );
      }
    } else {
      lines.push("  schedules: none — a propose_schedule would be genuinely useful here");
    }
  }

  return lines.join("\n");
}

/** Approximate token weight of the context (chars / 4) for guard accounting. */
export function contextTokenEstimate(text: string): number {
  return Math.ceil(text.length / 4);
}
