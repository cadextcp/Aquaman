# Memory

Update this after major decisions, completed phases, or bugs that future agents need to know about. Keep it short.

## Current State

- Current task: Planning complete — awaiting owner approval for Phase 1 build plan
- Current phase: Foundation (pre-build)
- Next step: Owner approves plan → scaffold Next.js project (Phase 1 Foundation)
- Blocked by: none

## Decisions

- 2026-08-23 Next.js 15 monolith (App Router) + SQLite/Drizzle — one container, one artifact, best AI-codegen support for Level-A owner (TechDesign §1)
- 2026-08-23 Anthropic-compatible AI via env `AI_BASE_URL` — one code path serves z.ai GLM and Anthropic Claude; never hardcode provider URL
- 2026-08-23 Flexible scheduling as first-class must-have: snooze + auto-reschedule; auto-reschedule only sets `snoozedUntil`, never writes fake logs (owner insight: stress phases must not break the app)
- 2026-08-23 Single-user v1 without login — protection via reverse proxy (Basic/Authelia); ICS + MCP endpoints token-gated
- 2026-08-23 Mobile-first UI: bottom-nav on phone, sidebar on desktop; dark aqua theme default; English UI first, German via next-intl (en first, de second)
- 2026-08-23 MCP tools: reads open, writes bearer-token gated, no delete/update tools; AI proposals always require human approval before persisting

## AI / Tooling Decisions

- 2026-08-23 Provider: Anthropic-compatible API (z.ai GLM-4.6 default; Claude as alternative) via `@anthropic-ai/sdk` with `baseURL` from env
- 2026-08-23 Cost ceiling: `AQUAMAN_AI_MAX_CALLS_PER_DAY=20` default, enforced via `aiCalls` table; AI pauses until midnight when hit
- 2026-08-23 Eval prompts defined in `agent_docs/testing.md` (nitrate-high, CO2-gasping, two-week-gap, injection-refusal)

## Known Issues

- none yet

## Completed

- [x] Initial scaffold (vibeworkflow: docs, AGENTS.md, agent_docs/, skills)
- [ ] Core data model
- [ ] Auth (n/a in v1 — reverse proxy)
- [ ] Core MVP flow
- [ ] Launch checks
