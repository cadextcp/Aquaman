/**
 * Network-safe projections of DB rows for the v1 REST API. Kept separate
 * from the MCP tool projections in src/lib/mcp/tools.ts — MCP shapes data
 * for an AI's condensed context, the REST API exposes the full resource.
 * Both independently omit photoPath (server-local filesystem path — never
 * sent over the network) and app_settings/tokens.
 */
import type { Tank, Schedule } from "@/lib/db/schema";

export function serializeTank(t: Tank) {
  return {
    id: t.id,
    name: t.name,
    volumeL: t.volumeL,
    waterType: t.waterType,
    plants: t.plants,
    fish: t.fish,
    foods: t.foods,
    hasCo2: t.hasCo2,
    hasHeater: t.hasHeater,
    hasFilter: t.hasFilter,
    filterType: t.filterType,
    tankState: t.tankState,
    paramOverrides: t.paramOverrides,
    createdAt: t.createdAt,
  };
}

export function serializeSchedule(s: Schedule & { tankName?: string }) {
  return {
    id: s.id,
    tankId: s.tankId,
    tankName: s.tankName,
    actionType: s.actionType,
    intervalDays: s.intervalDays,
    preferredDays: s.preferredDays,
    autoReschedule: s.autoReschedule,
    lastDoneAt: s.lastDoneAt,
    snoozedUntil: s.snoozedUntil,
    snoozeSource: s.snoozeSource,
    details: s.details,
    detailData: s.detailData,
    endsOn: s.endsOn,
    scheduleVersion: s.scheduleVersion,
    tightGapPolicy: s.tightGapPolicy,
    tightGapThresholdPct: s.tightGapThresholdPct,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    active: s.active,
  };
}
