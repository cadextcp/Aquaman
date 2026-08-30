/**
 * OpenAPI 3.1 document for the v1 REST API, generated from the SAME zod
 * schemas the routes validate with (via z.toJSONSchema(), built into zod
 * 4.4 — no extra dependency) so the docs cannot drift from the actual
 * validation. Served at GET /api/v1/openapi.json; rendered by Swagger UI at
 * GET /api/v1/docs.
 */
import { z } from "zod";
import { tankInputSchema, scheduleInputSchema, waterTestInputSchema, snoozeInputSchema } from "@/lib/schemas";
import { logActionSchema, waterTestUpdateSchema } from "@/lib/repo";
import { APP_VERSION } from "@/lib/version";

type JsonSchema = Record<string, unknown>;

function schema(s: z.ZodType): JsonSchema {
  const js = z.toJSONSchema(s) as JsonSchema;
  delete js.$schema;
  return js;
}

const idParam = (name: string, description: string) => ({
  name,
  in: "path" as const,
  required: true,
  description,
  schema: { type: "integer", minimum: 1 },
});

const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
});

const jsonBody = (ref: string) => ({
  required: true,
  content: { "application/json": { schema: { $ref: `#/components/schemas/${ref}` } } },
});

const jsonOk = (description: string, ref?: string) => ({
  description,
  content: ref ? { "application/json": { schema: { $ref: `#/components/schemas/${ref}` } } } : undefined,
});

const NOT_FOUND = errorResponse("Not found (also returned for an invalid/missing bearer token — see security note above)");
const BAD_REQUEST = errorResponse("Validation failed");

const tankOutSchema: JsonSchema = {
  type: "object",
  properties: {
    id: { type: "integer" },
    name: { type: "string" },
    volumeL: { type: "integer" },
    waterType: { type: "string", enum: ["fresh", "salt"] },
    plants: { type: "array", items: { type: "object" } },
    fish: { type: "array", items: { type: "object" } },
    foods: { type: "array", items: { type: "object" } },
    hasCo2: { type: "boolean" },
    hasHeater: { type: "boolean" },
    hasFilter: { type: "boolean" },
    filterType: { type: ["string", "null"] },
    tankState: { type: "string", enum: ["cycling", "established"] },
    paramOverrides: { type: "object" },
    createdAt: { type: "string", format: "date-time" },
  },
};

const scheduleOutSchema: JsonSchema = {
  type: "object",
  properties: {
    id: { type: "integer" },
    tankId: { type: "integer" },
    tankName: { type: "string" },
    actionType: { type: "string" },
    intervalDays: { type: "integer" },
    preferredDays: { type: "integer", description: "7-bit weekday mask, bit 0 = Monday" },
    autoReschedule: { type: "boolean" },
    lastDoneAt: { type: ["string", "null"], format: "date-time" },
    snoozedUntil: { type: ["string", "null"], format: "date-time" },
    details: { type: ["string", "null"] },
    detailData: { type: ["object", "null"] },
    endsOn: { type: ["string", "null"], format: "date" },
    scheduleVersion: { type: "integer" },
    active: { type: "boolean" },
  },
};

const componentSchemas: Record<string, JsonSchema> = {
  Error: {
    type: "object",
    properties: {
      error: { type: "string" },
      fieldErrors: { type: "object", additionalProperties: { type: "string" } },
    },
    required: ["error"],
  },
  TankInput: schema(tankInputSchema),
  Tank: tankOutSchema,
  ScheduleInput: schema(scheduleInputSchema),
  Schedule: scheduleOutSchema,
  SnoozeInput: schema(snoozeInputSchema.pick({ until: true })),
  DoneInput: { type: "object", properties: { note: { type: "string", maxLength: 500 } } },
  WaterTestInput: schema(waterTestInputSchema),
  WaterTestUpdateInput: schema(waterTestUpdateSchema),
  ActionInput: schema(logActionSchema),
  FeedingInput: {
    type: "object",
    properties: {
      day: { type: "string", format: "date", description: "YYYY-MM-DD, defaults to today; up to 30 days in the past" },
      delta: { type: "integer", enum: [1, -1] },
    },
    required: ["delta"],
  },
};


const paths: Record<string, JsonSchema> = {
  "/tanks": {
    get: {
      summary: "List tanks",
      tags: ["Tanks"],
      responses: {
        200: jsonOk("Tanks", undefined),
      },
    },
    post: {
      summary: "Create a tank",
      tags: ["Tanks"],
      requestBody: jsonBody("TankInput"),
      responses: { 201: jsonOk("Created", undefined), 400: BAD_REQUEST },
    },
  },
  "/tanks/{id}": {
    parameters: [idParam("id", "Tank id")],
    get: {
      summary: "Get a tank",
      tags: ["Tanks"],
      responses: { 200: jsonOk("Tank", "Tank"), 404: NOT_FOUND },
    },
    patch: {
      summary: "Update a tank (full replace of the editable fields, same shape as create)",
      tags: ["Tanks"],
      requestBody: jsonBody("TankInput"),
      responses: { 200: jsonOk("Tank", "Tank"), 400: BAD_REQUEST, 404: NOT_FOUND },
    },
    delete: {
      summary: "Soft-delete a tank (tanks.deletedAt; history is kept)",
      tags: ["Tanks"],
      responses: { 204: { description: "Deleted" } },
    },
  },
  "/tanks/{id}/status": {
    parameters: [idParam("id", "Tank id")],
    get: {
      summary: "Display summary: the tank plus, per actionType, when it was last done and (if a plan exists) the schedule state",
      tags: ["Tanks"],
      responses: { 200: { description: "Status" }, 404: NOT_FOUND },
    },
  },
  "/tanks/{id}/actions": {
    parameters: [idParam("id", "Tank id")],
    get: {
      summary: "Maintenance-log history for one tank",
      tags: ["Actions"],
      parameters: [
        { name: "type", in: "query", schema: { type: "string" }, description: "Filter to one actionType" },
        { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 200, default: 20 } },
      ],
      responses: { 200: { description: "Log entries" }, 404: NOT_FOUND },
    },
  },
  "/actions": {
    post: {
      summary: "Log a care action (any actionType except feed, which has its own endpoint at /tanks/{id}/feedings)",
      tags: ["Actions"],
      requestBody: jsonBody("ActionInput"),
      responses: { 201: { description: "Logged" }, 400: BAD_REQUEST, 404: NOT_FOUND },
    },
  },
  "/tanks/{id}/feedings": {
    parameters: [idParam("id", "Tank id")],
    get: {
      summary: "Feeding history (feed_logs, one row per day, a 0..5 count)",
      tags: ["Feedings"],
      parameters: [{ name: "days", in: "query", schema: { type: "integer", minimum: 1, maximum: 365, default: 30 } }],
      responses: { 200: { description: "Feedings" }, 404: NOT_FOUND },
    },
    post: {
      summary: "Adjust today's (or a backfilled day's) feed count by +/-1",
      tags: ["Feedings"],
      requestBody: jsonBody("FeedingInput"),
      responses: { 200: { description: "New count" }, 400: BAD_REQUEST, 404: NOT_FOUND },
    },
  },
  "/tanks/{id}/water-tests": {
    parameters: [idParam("id", "Tank id")],
    get: {
      summary: "Water-test history for one tank",
      tags: ["Water tests"],
      parameters: [{ name: "days", in: "query", schema: { type: "integer", minimum: 1, maximum: 3650, default: 90 } }],
      responses: { 200: { description: "Water tests" }, 404: NOT_FOUND },
    },
  },
  "/water-tests": {
    post: {
      summary: "Record a water test (known parameter keys only, see GET /water-parameters; plausibility-bounded)",
      tags: ["Water tests"],
      requestBody: jsonBody("WaterTestInput"),
      responses: { 201: { description: "Recorded" }, 400: BAD_REQUEST, 404: NOT_FOUND },
    },
  },
  "/water-tests/{id}": {
    parameters: [idParam("id", "Water test id")],
    patch: {
      summary: "Edit a water test",
      tags: ["Water tests"],
      requestBody: jsonBody("WaterTestUpdateInput"),
      responses: { 200: { description: "Updated" }, 400: BAD_REQUEST, 404: NOT_FOUND },
    },
    delete: {
      summary: "Delete a water test",
      tags: ["Water tests"],
      responses: { 204: { description: "Deleted" }, 404: NOT_FOUND },
    },
  },
  "/water-parameters": {
    get: {
      summary: "Known water-test parameter keys and target ranges, per water type",
      tags: ["Water tests"],
      responses: { 200: { description: "Parameter catalog" } },
    },
  },
};

Object.assign(paths, {
  "/schedules": {
    get: {
      summary: "List active care plans (optionally filtered to one tank)",
      tags: ["Schedules"],
      parameters: [{ name: "tankId", in: "query", schema: { type: "integer", minimum: 1 } }],
      responses: { 200: { description: "Schedules" } },
    },
    post: {
      summary: "Create a care plan (one per actionType per tank for the built-in types)",
      tags: ["Schedules"],
      requestBody: jsonBody("ScheduleInput"),
      responses: { 201: { description: "Created" }, 400: BAD_REQUEST, 404: NOT_FOUND, 409: errorResponse("This tank already has a plan of this type") },
    },
  },
  "/schedules/{id}": {
    parameters: [idParam("id", "Schedule id")],
    get: {
      summary: "Get a care plan",
      tags: ["Schedules"],
      responses: { 200: jsonOk("Schedule", "Schedule"), 404: NOT_FOUND },
    },
    patch: {
      summary: "Update a care plan (full replace, same shape as create)",
      tags: ["Schedules"],
      requestBody: jsonBody("ScheduleInput"),
      responses: { 200: jsonOk("Schedule", "Schedule"), 400: BAD_REQUEST, 404: NOT_FOUND, 409: errorResponse("Another active plan already has this actionType") },
    },
    delete: {
      summary: "Delete a care plan (hard delete; history stays, it hangs off tankId+actionType, not the plan)",
      tags: ["Schedules"],
      responses: { 204: { description: "Deleted" }, 404: NOT_FOUND },
    },
  },
  "/schedules/{id}/done": {
    parameters: [idParam("id", "Schedule id")],
    post: {
      summary: "Mark the plan's current occurrence done",
      tags: ["Schedules"],
      requestBody: { required: false, content: { "application/json": { schema: { "$ref": "#/components/schemas/DoneInput" } } } },
      responses: { 200: { description: "Done" }, 404: NOT_FOUND },
    },
  },
  "/schedules/{id}/snooze": {
    parameters: [idParam("id", "Schedule id")],
    post: {
      summary: "Snooze to a later date (taken literally, no weekday shifting)",
      tags: ["Schedules"],
      requestBody: jsonBody("SnoozeInput"),
      responses: { 200: { description: "Snoozed" }, 400: BAD_REQUEST, 404: NOT_FOUND },
    },
  },
  "/schedules/{id}/undo": {
    parameters: [idParam("id", "Schedule id")],
    post: {
      summary: "Undo the most recent completion, restoring the previous lastDoneAt",
      tags: ["Schedules"],
      responses: { 200: { description: "Undone" }, 404: NOT_FOUND },
    },
  },
  "/tasks": {
    get: {
      summary: "Open maintenance across active plans (dashboard projection: plannedFor, overdueDays, missedSlots)",
      tags: ["Tasks"],
      parameters: [{ name: "tankId", in: "query", schema: { type: "integer", minimum: 1 } }],
      responses: { 200: { description: "Tasks" } },
    },
  },
});

export function buildOpenApiDocument(baseUrl: string): JsonSchema {
  return {
    openapi: "3.1.0",
    info: {
      title: "AquaMon API",
      version: APP_VERSION,
      description:
        "Generic REST control surface for AquaMon: tanks, care plans, maintenance history, feedings, water tests. " +
        "Not tailored to any one client; built so any external system (an ESPHome display, Home Assistant, a script) " +
        "can read and drive AquaMon. Auth: Authorization: Bearer <apiToken>, shown/rotated under More -> API. " +
        "An invalid or missing token returns 404, the same never-confirm-the-endpoint-exists rule /api/mcp uses; " +
        "a real 404 for a missing resource looks identical from the outside by design.",
    },
    servers: [{ url: baseUrl }],
    tags: [
      { name: "Tanks" },
      { name: "Schedules", description: "Recurring care plans (water changes, fertilizing, ...)" },
      { name: "Tasks", description: "Read-only due-date projection over active plans" },
      { name: "Actions", description: "Point-in-time maintenance history" },
      { name: "Feedings", description: "Daily feed count, not a schedule" },
      { name: "Water tests" },
    ],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer" },
      },
      schemas: componentSchemas,
    },
    security: [{ bearerAuth: [] }],
    paths,
  };
}
