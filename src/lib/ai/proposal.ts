/**
 * propose_schedule — the ONE structured output the coach may produce
 * (TechDesign §4.5). Tool input schema for the API (JSON Schema, hand-written
 * because the provider needs raw JSON) + the SAME shape as zod for our side.
 * Malformed output → reject, never repair (AGENTS AI rules).
 *
 * The proposal is a DRAFT. Nothing touches the DB until the user taps
 * "Apply" → applyProposedProposal() re-validates with this very zod schema.
 */
import { z } from "zod";

export const PROPOSAL_TOOL_NAME = "propose_schedule";

export const PROPOSAL_TOOL_DESCRIPTION = `Propose maintenance schedule changes as a draft for the user to approve.
Use when: a tank has no schedules yet, water values suggest a different cadence (e.g. nitrate rising → shorter water-change interval), or a task repeatedly misses its slots (missedSlots >= 3 → suggest a LONGER interval).
preferredDays is a 7-bit weekday bitmask: bit0=Mon(1) Tue(2) Wed(4) Thu(8) Fri(16) Sat(32) Sun(64). Examples: 127=every day, 96=weekend only (Sat+Sun), 31=weekdays.
Keep it minimal: only the changes that matter, with a short rationale each.`;

/** JSON Schema handed to the provider (mirrors proposalSchema below). */
export const PROPOSAL_TOOL_INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    rationale: { type: "string", description: "One or two sentences: why these changes" },
    changes: {
      type: "array",
      description: "Schedule changes to propose (1–6)",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["create", "adjust"], description: "create = new schedule, adjust = change an existing one" },
          tankId: { type: "integer", description: "Tank for kind=create (from context TANK #id)" },
          scheduleId: { type: "integer", description: "Existing schedule for kind=adjust (from context #id)" },
          actionType: { type: "string", description: "For create: e.g. water_change, fertilize, filter_clean" },
          intervalDays: { type: "integer", description: "New interval in days (1–365)" },
          preferredDays: { type: "integer", description: "7-bit weekday mask: 1=Mon … 64=Sun; 127=every day; 96=weekend" },
          details: { type: "string", description: "Concrete instructions for the task, e.g. '30 L of 60 L (50 %) water change' or '10 ml iron fertilizer'. Fertilizer/water-change amounts only — NEVER medication. Always append: (verify dosage against the product label)" },
          note: { type: "string", description: "Optional short reason for this single change" },
        },
        required: ["kind", "intervalDays"],
      },
    },
  },
  required: ["rationale", "changes"],
};

// ==================== zod (our side of the contract) ====================

export const proposalChangeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("create"),
    tankId: z.number().int().positive(),
    actionType: z.string().trim().min(1).max(40),
    intervalDays: z.number().int().min(1).max(365),
    preferredDays: z.number().int().min(1).max(127),
    details: z.string().trim().max(300).optional(),
    note: z.string().trim().max(200).optional(),
  }),
  z.object({
    kind: z.literal("adjust"),
    scheduleId: z.number().int().positive(),
    intervalDays: z.number().int().min(1).max(365),
    details: z.string().trim().max(300).optional(),
    note: z.string().trim().max(200).optional(),
  }),
]);

export const proposalSchema = z.object({
  rationale: z.string().trim().min(1).max(500),
  changes: z.array(proposalChangeSchema).min(1).max(6),
});

export type ProposalChange = z.infer<typeof proposalChangeSchema>;
export type Proposal = z.infer<typeof proposalSchema>;

/** Strict validation — malformed model output is REJECTED, never repaired. */
export function parseProposal(input: unknown): Proposal | null {
  const parsed = proposalSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}
