/** Bearer gate for the v1 REST API — same 404/429 contract as /api/mcp (bearerGate), separate token and rate-limit scope so rotating one never locks out the other. */
import { NextRequest } from "next/server";
import { getOrCreateApiToken, safeTokenEqual } from "@/lib/api-token";
import { bearerGate } from "@/lib/api/guard";

export function apiGate(req: NextRequest) {
  return bearerGate(req, "api", getOrCreateApiToken, safeTokenEqual);
}
