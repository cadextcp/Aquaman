/**
 * Uniform JSON envelope for the v1 REST API (`/api/v1/*`). Every route
 * returns one of these two shapes so a generic client (an ESPHome display,
 * curl, Swagger UI's "Try it out") never has to branch on which endpoint it
 * called to find the error message.
 */
import { NextResponse } from "next/server";
import type { ErrorCode } from "@/lib/domain/errors";

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function fail(
  status: number,
  error: string,
  fieldErrors?: Record<string, string>,
  code?: ErrorCode,
): NextResponse {
  return NextResponse.json({ error, ...(code ? { code } : {}), ...(fieldErrors ? { fieldErrors } : {}) }, { status });
}

/** HTTP status for a failure code — replaces matching on the message text. */
const STATUS_BY_CODE: Partial<Record<ErrorCode, number>> = {
  "tank.notFound": 404,
  "schedule.notFound": 404,
  "waterTest.notFound": 404,
  "schedule.duplicateType": 409,
};

/**
 * Turn a core failure into a response. `error` stays exactly what the core
 * produced (the API's contract), `code` is served alongside it so clients can
 * branch on a stable identifier instead of matching English prose — which is
 * what these routes themselves used to do.
 */
export function failFor(
  res: { error: string; code: ErrorCode },
  fallbackStatus = 400,
): NextResponse {
  return fail(STATUS_BY_CODE[res.code] ?? fallbackStatus, res.error, undefined, res.code);
}

/** 404 for "resource not found" — distinct from the gate's auth-404, but the same status code by REST convention. */
export function notFound(what = "Not found"): NextResponse {
  return fail(404, what);
}
