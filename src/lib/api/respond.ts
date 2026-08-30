/**
 * Uniform JSON envelope for the v1 REST API (`/api/v1/*`). Every route
 * returns one of these two shapes so a generic client (an ESPHome display,
 * curl, Swagger UI's "Try it out") never has to branch on which endpoint it
 * called to find the error message.
 */
import { NextResponse } from "next/server";

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function fail(status: number, error: string, fieldErrors?: Record<string, string>): NextResponse {
  return NextResponse.json({ error, ...(fieldErrors ? { fieldErrors } : {}) }, { status });
}

/** 404 for "resource not found" — distinct from the gate's auth-404, but the same status code by REST convention. */
export function notFound(what = "Not found"): NextResponse {
  return fail(404, what);
}
