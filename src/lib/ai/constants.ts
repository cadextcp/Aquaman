/**
 * Constants importable from BOTH client and server (no DB access here).
 * config.ts stays server-only — that's what lets it import settings.ts
 * statically (issue #40 precedence) without bundler gymnastics.
 */

/** Rolling history size for the coach chat (single-call pattern, §9). */
export const MAX_HISTORY_MESSAGES = 12;
