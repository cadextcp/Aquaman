/**
 * MCP server factory (product v1.1 — TechDesign §4.6).
 *
 * Per-request instance over the stateless Streamable HTTP transport (JSON
 * responses, no session): the entire endpoint is bearer-gated at the route,
 * so the server itself holds no per-session state and survives restarts
 * invisibly for the client.
 *
 * Tool surface is READ-heavy BY DESIGN: get_tanks, get_products,
 * get_water_values, get_pending_maintenance, plus exactly three write tools that reuse the
 * in-app cores (add_water_test, log_maintenance, snooze_task) and ask_coach
 * behind the shared AI budget. NO delete/update tools (TechDesign §4.6) —
 * an agent can record care, never destroy or rewrite history.
 */
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { APP_VERSION } from "@/lib/version";
import {
  getTanks,
  getProducts,
  getWaterValues,
  getPendingMaintenance,
  addWaterTest,
  logMaintenance,
  snoozeTask,
  askCoach,
  type ToolOutcome,
} from "./tools";

function textResult(outcome: ToolOutcome) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(outcome.ok ? outcome.payload : { error: outcome.error }) }],
    isError: !outcome.ok,
  };
}

export function createAquamanMcpServer(): McpServer {
  const server = new McpServer({ name: "aquaman", version: APP_VERSION });

  server.registerTool(
    "get_tanks",
    { description: "List all aquarium tanks with volume, water type, livestock, equipment and cycling state." },
    () => textResult(getTanks()),
  );

  server.registerTool(
    "get_products",
    {
      description:
        "The fertilizer and food products the user actually owns, with the nutrients a fertilizer contains and the label notes they typed in. Recommend from these rather than naming products they do not have.",
      inputSchema: {
        kind: z.enum(["fertilizer", "food"]).optional().describe("Restrict to fertilizers or foods"),
      },
    },
    ({ kind }) => textResult(getProducts({ kind })),
  );

  server.registerTool(
    "get_water_values",
    {
      description:
        "Water test history per tank. Returns stored values plus an evaluation of the latest test (ok/warn/critical, incl. free NH3 computed from NH4 + pH + temperature).",
      inputSchema: {
        tankId: z.number().int().positive().optional().describe("Restrict to one tank"),
        days: z.number().int().min(1).max(365).optional().describe("History window in days (default 90)"),
      },
    },
    ({ tankId, days }) => textResult(getWaterValues({ tankId, days })),
  );

  server.registerTool(
    "get_pending_maintenance",
    {
      description:
        "Open maintenance tasks (uses the same projection as the dashboard): planned date, honest original due date, overdue days, missed slots and a 'too tight interval' hint when slots were missed repeatedly.",
      inputSchema: {
        tankId: z.number().int().positive().optional().describe("Restrict to one tank"),
      },
    },
    ({ tankId }) => textResult(getPendingMaintenance({ tankId })),
  );

  server.registerTool(
    "add_water_test",
    {
      description:
        "Record a water test (same validation as the app: known parameters only, plausible bounds). Parameter keys follow the catalog, e.g. ph, temp, kh, gh, nh4, no2, no3.",
      inputSchema: {
        tankId: z.number().int().positive().describe("Tank the test belongs to"),
        values: z.record(z.string(), z.number().nonnegative().nullable()).describe("Parameter values, e.g. { \"no3\": 25, \"ph\": 7.4 }"),
        measuredAt: z.string().datetime().optional().describe("ISO-8601 timestamp (defaults to now)"),
        note: z.string().trim().max(500).optional(),
      },
    },
    (args) => textResult(addWaterTest(args)),
  );

  server.registerTool(
    "log_maintenance",
    {
      description: "Mark a maintenance task as DONE (logs the completion — the equivalent of tapping 'Done' in the app).",
      inputSchema: {
        scheduleId: z.number().int().positive().describe("Schedule id from get_pending_maintenance"),
        note: z.string().trim().max(500).optional(),
      },
    },
    (args) => textResult(logMaintenance(args)),
  );

  server.registerTool(
    "snooze_task",
    {
      description: "Snooze a task to a later date (today or later, taken literally — no weekday shifting).",
      inputSchema: {
        scheduleId: z.number().int().positive().describe("Schedule id from get_pending_maintenance"),
        until: z.string().date().describe("Snooze target date, YYYY-MM-DD"),
      },
    },
    (args) => textResult(snoozeTask(args)),
  );

  server.registerTool(
    "ask_coach",
    {
      description:
        "Ask the AI coach a question about the tanks (advice, interpretation of water values). Shares the in-app daily AI budget; schedule CHANGES proposed by the coach are NOT applied here — they require approval in the AquaMon UI.",
      inputSchema: {
        question: z.string().trim().min(1).max(2000).describe("The question, max 2000 chars"),
      },
    },
    async (args) => textResult(await askCoach(args)),
  );

  return server;
}
