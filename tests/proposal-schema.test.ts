/**
 * Contract test (2026-08-30 regression): the JSON Schema handed to the
 * provider must demand every field the app-side zod schema requires.
 *
 * The tool schema used to require only kind+intervalDays, so the model
 * legitimately omitted preferredDays/tankId/actionType on kind=create —
 * and proposalSchema then rejected every create-proposal ("failed
 * validation — nothing was saved"). The fix pins BOTH sides: the schema
 * lists the required fields AND zod still accepts exactly the payloads
 * that satisfy them.
 */
import { describe, it, expect } from "vitest";
import { PROPOSAL_TOOL_INPUT_SCHEMA, parseProposal } from "../src/lib/ai/proposal";

type ConditionalBranch = { if: { properties: { kind: { const: string } } }; then: { required: string[] } };
type ItemsSchema = { properties: { changes: { items: { required: string[]; allOf: ConditionalBranch[] } } } };
const items = (PROPOSAL_TOOL_INPUT_SCHEMA as ItemsSchema).properties.changes.items;

/** The extra fields required on top of the base `required` list for one `kind`. */
function requiredFor(kind: string): string[] {
  const branch = items.allOf.find((b) => b.if.properties.kind.const === kind);
  return branch?.then.required ?? [];
}

describe("propose_schedule JSON schema ↔ zod contract", () => {
  it("base required fields apply to every kind", () => {
    for (const key of ["kind", "intervalDays"]) {
      expect(items.required).toContain(key);
    }
  });

  it("tool schema requires every zod-mandatory field of kind=create", () => {
    for (const key of ["tankId", "actionType", "preferredDays"]) {
      expect(requiredFor("create")).toContain(key);
    }
  });

  it("tool schema requires scheduleId for kind=adjust, and never tankId/actionType", () => {
    expect(requiredFor("adjust")).toContain("scheduleId");
    expect(requiredFor("adjust")).not.toContain("tankId");
    expect(requiredFor("adjust")).not.toContain("actionType");
  });

  it("zod still rejects what the tool schema forbids: create without preferredDays", () => {
    const missing = {
      rationale: "One-off filter change.",
      changes: [{ kind: "create", tankId: 3, actionType: "filter_change", intervalDays: 122 }],
    };
    expect(parseProposal(missing)).toBeNull();
  });

  it("a complete create-proposal (all required fields) parses", () => {
    const complete = {
      rationale: "One-off filter change in 4 months.",
      changes: [
        {
          kind: "create",
          tankId: 3,
          actionType: "filter_change",
          intervalDays: 122,
          preferredDays: 127,
          details: "Replace part of the filter media (keep the biofilm)",
          note: "User asked for a change in 4 months",
        },
      ],
    };
    const parsed = parseProposal(complete);
    expect(parsed).not.toBeNull();
    expect(parsed!.changes[0]).toMatchObject({ kind: "create", tankId: 3, preferredDays: 127 });
  });

  it("an adjust-proposal parses when scheduleId is present", () => {
    const adjust = {
      rationale: "Shorten the water-change cadence.",
      changes: [{ kind: "adjust", scheduleId: 13, intervalDays: 5, preferredDays: 127 }],
    };
    expect(parseProposal(adjust)).not.toBeNull();
  });

  it("zod rejects what the tool schema now also forbids: adjust without scheduleId", () => {
    const missing = {
      rationale: "Shorten the water-change cadence.",
      changes: [{ kind: "adjust", intervalDays: 5, preferredDays: 127 }],
    };
    expect(parseProposal(missing)).toBeNull();
  });
});
