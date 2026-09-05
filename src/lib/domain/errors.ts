/**
 * Failure codes shared by every write path.
 *
 * The problem this solves: the cores in repo.ts are reached by BOTH the UI
 * (Server Actions) and machines (v1 REST API, MCP). A single English string
 * cannot serve both — the API's contract is that `error` stays English and
 * stable, while the person in front of a German app should read German.
 *
 * So a failure carries both: `error` (English, machine-facing, unchanged) and
 * `code` (+ `vars` for the parts that vary). The UI renders `error.<code>`
 * from the catalogs; API clients keep reading `error` and may now branch on
 * `code` instead of matching message text.
 *
 * Client-safe: no DB or Node imports, so components can import the type.
 */

export const ERROR_CODES = [
  "validation",
  "tank.notFound",
  "tank.createFailed",
  "tank.updateFailed",
  "tank.deleteFailed",
  "schedule.notFound",
  "schedule.createFailed",
  "schedule.updateFailed",
  "schedule.deleteFailed",
  "schedule.duplicateType",
  "schedule.doneFailed",
  "snooze.pastDate",
  "snooze.failed",
  "undo.nothing",
  "undo.failed",
  "waterTest.notFound",
  "waterTest.saveFailed",
  "waterTest.updateFailed",
  "waterTest.deleteFailed",
  "values.invalid",
  "feed.failed",
  "feed.invalidDate",
  "feed.futureDate",
  "feed.backfillLimit",
  "log.failed",
  "log.notLoggable",
  "log.feedIsCounter",
  "product.notFound",
  "product.createFailed",
  "product.updateFailed",
  "product.deleteFailed",
  "product.duplicateName",
  "token.rotateFailed",
  "settings.invalid",
  "proposal.invalid",
  "import.failed",
  // URL import for new inventory products (docs/plan-produkt-import-url.md §7).
  // Split fine because the UI reacts differently: only the network-shaped
  // failures offer "paste the text instead"; a blocked address does not.
  "productImport.invalidUrl",
  "productImport.blockedAddress",
  "productImport.unreachable",
  "productImport.blocked",
  "productImport.notHtml",
  "productImport.tooThin",
  "productImport.noProduct",
  "productImport.aiOffline",
  "productImport.limitReached",
  "productImport.rateLimited",
  "productImport.draftInvalid",
  // Stage 3 (label photo): both refusals are decided before the provider call,
  // so an unreadable or oversized file costs zero tokens (plan §10).
  "productImport.imageTooLarge",
  "productImport.unsupportedImage",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Values interpolated into the localized message ({action}, {detail}, …). */
export type ErrorVars = Record<string, string | number>;

export type Failure = {
  ok: false;
  /** English, machine-facing — the REST API and MCP serve this verbatim. */
  error: string;
  code: ErrorCode;
  vars?: ErrorVars;
};

/** Build a failure result: one code, one English message, optional parts. */
export function failure(code: ErrorCode, error: string, vars?: ErrorVars): Failure {
  return vars ? { ok: false, error, code, vars } : { ok: false, error, code };
}
