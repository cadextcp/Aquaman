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
STRICT output contract — the app rejects any change that misses a required field:
- Every change MUST include kind and intervalDays. For kind=create ALSO include tankId, actionType and preferredDays. For kind=adjust ALSO include scheduleId of the existing schedule (never tankId/actionType — the schedule already has those).
- actionType must be exactly one of: water_change, fertilize, feed, filter_change, water_test (or a short snake_case custom label).
- preferredDays is a 7-bit weekday bitmask: bit0=Mon(1) Tue(2) Wed(4) Thu(8) Fri(16) Sat(32) Sun(64). Examples: 127=every day, 96=weekend only (Sat+Sun), 31=weekdays. Use 127 when the user gives no weekday preference.
- Never send an empty changes array, and always also write a short visible summary of what you proposed.
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
          tankId: { type: "integer", description: "REQUIRED. Tank for kind=create (from context TANK #id); for kind=adjust the tank that owns the schedule" },
          scheduleId: { type: "integer", description: "REQUIRED for kind=adjust: the existing schedule (from context #id)" },
          actionType: { type: "string", description: "REQUIRED. Exact standard type: water_change | fertilize | feed | filter_change | water_test (or a short snake_case custom label)" },
          intervalDays: { type: "integer", description: "REQUIRED. Interval in days (1–365)" },
          preferredDays: { type: "integer", description: "REQUIRED. 7-bit weekday mask: 1=Mon … 64=Sun; 127=every day; 96=weekend. Use 127 if the user names no weekdays" },
          details: { type: "string", description: "Concrete instructions for the task, e.g. '30 L of 60 L (50 %) water change' or '10 ml iron fertilizer'. Fertilizer/water-change amounts only — NEVER medication. Always append: (verify dosage against the product label)" },
          detailData: { type: "object", description: "Structured details. water_change: {percent}; fertilize: {nutrients:{c_co2|n_no3|p_po4|k|mg|ca|fe|mn|zn|b|mo|cu: 'dose'}}; feed: {foods:{'Food name':'amount'}}. Keep it consistent with details." },
          note: { type: "string", description: "Optional short reason for this single change" },
        },
        // Mirrors proposalChangeSchema's per-kind required fields (zod is the
        // last gate, this is the first): whatever zod demands, the model must
        // already be told to send — 2026-08-30: GLM legitimately omitted
        // preferredDays here and every create-proposal failed validation.
        // A flat `required` list can't express "tankId only for create,
        // scheduleId only for adjust" — it either over-requires create-only
        // fields on adjust or never requires scheduleId at all, so this uses
        // if/then per kind exactly like the zod discriminated union below.
        required: ["kind", "intervalDays"],
        allOf: [
          {
            if: { properties: { kind: { const: "create" } } },
            then: { required: ["tankId", "actionType", "preferredDays"] },
          },
          {
            if: { properties: { kind: { const: "adjust" } } },
            then: { required: ["scheduleId"] },
          },
        ],
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
    detailData: z.record(z.string(), z.unknown()).optional(),
    note: z.string().trim().max(200).optional(),
  }),
  z.object({
    kind: z.literal("adjust"),
    scheduleId: z.number().int().positive(),
    intervalDays: z.number().int().min(1).max(365),
    details: z.string().trim().max(300).optional(),
    detailData: z.record(z.string(), z.unknown()).optional(),
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


// ==================== daily suggestions (issue #41) ====================

/**
 * 5 clickable coach suggestions per day, context-aware. Generated ONCE per
 * local day (purpose 'suggestions', one AI call), cached in appSettings.
 */
export const suggestionSchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  items: z
    .array(
      z.object({
        label: z.string().trim().min(3).max(80), // chip text
        prompt: z.string().trim().min(3).max(400), // what gets sent to the coach
      }),
    )
    .min(1)
    .max(6),
});
export type DailySuggestions = z.infer<typeof suggestionSchema>;

export function parseSuggestions(input: unknown): DailySuggestions | null {
  const parsed = suggestionSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}
