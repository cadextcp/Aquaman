# Memory

Keep short. Update after major decisions or completed phases. (Note: Claude Code
manages its own memory automatically — this file serves other agents and humans.)

## Current State

- Current task: Phase 4 (AI Coach) implemented — AI client (Anthropic-compatible), /coach chat with NDJSON streaming, propose_schedule approval gate, two-tier cost guard
- Current phase: Phase 4 done, awaiting review/merge; Phase 5 (Launch: export/import, stats, README, v0.1.0) next
- Next step: review Phase 4 diff → merge → Phase 5
- Blocked by: none

## Decisions

- 2026-08-23 Next.js 15 monolith (App Router) + SQLite/Drizzle — one container, one artifact, best AI-codegen support for Level-A owner
- 2026-08-23 Anthropic-compatible AI via `AQUAMAN_AI_BASE_URL` (durchgängiges Präfix) — one code path for z.ai GLM and Claude; re-verify z.ai docs before build start
- 2026-08-23 Flexible scheduling core: `originalDueAt` weekday-gridded at creation then never moves (honest backlog) / `plannedFor` read-projection (clean plan); auto-reschedule NEVER writes DB or logs; `missedSlots()` pure formula (no stored counter) ≥ 3 → "interval too tight?"
- 2026-08-23 Feeding = daily habit (dashboard checkbox), NOT a schedule, NOT in ICS
- 2026-08-23 SQLite-typing: text({mode:'json'}) + 7-bit weekday mask (no jsonb/int[])
- 2026-08-23 `AQUAMAN_TIMEZONE` (default Europe/Berlin) governs all today/midnight logic via Intl helpers; weekday mask Bit 0 = Mon via `localWeekdayIndex()`
- 2026-08-23 ICS: expanded VEVENTs via `occurrencesInRange()` (current occurrence projected, future on fixed grid); UID `{scheduleId}-{originalDueAtISO}@aquaman` — keyed on the immutable target so snooze/reschedule move `DTSTART` instead of delete+recreate; `SEQUENCE = scheduleVersion + missedSlots`, `DTSTAMP = updatedAt`; byte-identical feed test; invalid token → 404; rate limit
- 2026-08-24 Phase 3: `occurrenceDetailsInRange()` added (returns `{originalDueAt, plannedFor}` pairs per occurrence — `occurrencesInRange()` is now a thin `.map(plannedFor)` wrapper over it, same algorithm, zero behavior change, verified against all 25 prior scheduler tests unchanged). This is what makes the UID-per-occurrence scheme in `ics.ts` possible: only the CURRENT occurrence's identity differs from its display date, every future grid point IS its own originalDueAt.
- 2026-08-24 ICS token: stored in `appSettings` (plaintext, needed to render the subscribe URL in Settings), compared via SHA-256(both sides)+`timingSafeEqual` (never raw — avoids a `RangeError`/500 on a wrong-length token, which would leak the token's length). Lazy-created on first read so a fresh install needs no manual setup step.
- 2026-08-24 ICS route (`/api/calendar.ics`) verified end-to-end against a real RFC 5545 parser (Python `icalendar`), and the UID-survives-snooze property verified against a live server + real DB: snoozing a schedule keeps `UID` identical and only moves `DTSTART`, with `SEQUENCE` incrementing — confirmed this is a genuine "event moved" from a calendar client's perspective, not delete+recreate.
- 2026-08-24 Calendar month view: Monday-start grid via new `monthGridRange()`/`shiftMonth()` in `dates.ts` (pure, tested), reuses `occurrencesInRange()` — one occurrence-expansion algorithm shared by dashboard, calendar UI, and the ICS feed, per the API-first design goal.
- 2026-08-23 MCP moved to product v1.1 (owner decision after plan review); fully bearer-gated
- 2026-08-23 Two-tier AI cost ceiling (calls AND tokens); streaming usage from final event
- 2026-08-23 NH3 calculated from NH4+pH+temp (Emerson 1975), evaluated instead of raw NH4; NO2 target 0 established; tankState cycling|established
- 2026-08-23 Docker in Phase 1 as vertical slice (avoid late deployment surprises); ports 127.0.0.1-only
- 2026-08-23 Timeline corrected: 6–8 weeks part-time (was 2–4, review called it unrealistic)

## AI / Tooling Decisions

- 2026-08-23 Provider: Anthropic-compatible API (z.ai GLM default; Claude alternative) via @anthropic-ai/sdk + baseURL env
- 2026-08-23 Cost ceiling: AQUAMAN_AI_MAX_CALLS_PER_DAY=20 AND AQUAMAN_AI_MAX_TOKENS_PER_DAY≈200k; reset local midnight
- 2026-08-23 Eval prompts in agent_docs/testing.md (nitrate-high, NH3-at-pH-8, CO2-gasping, two-week-gap, injection-refusal)

## Decisions

- 2026-08-24 Phase 4 AI client: single code path via @anthropic-ai/sdk with baseURL env — one path for api.anthropic.com AND z.ai GLM. tool_use inputs accumulated from input_json_delta chunks, zod-validated on content_block_stop (reject, never repair). Usage from message_start (input) + message_delta (output) — the only events that carry real counts.
- 2026-08-24 Approval gate: `applyProposal` in src/app/actions-ai.ts is the ONLY write path for AI proposals. Re-validates proposal (zod) + live data (tank live, schedule active) at write time — the AI saw a snapshot, the write must survive a stale one. Partial application with per-change results (one stale id doesn't block valid rest). adjust bumps scheduleVersion (ICS SEQUENCE) and clears snooze (changed plan invalidates it).
- 2026-08-24 Coach route `/api/coach`: POST-only NDJSON stream, not token-gated (sits behind reverse proxy like every page). Input caps (question 2000 chars, history 12×4000), failure-only rate limit (30/h per IP, same limiter as ICS, key prefix coach:), guards BEFORE any provider call: no config → 503, budget → 429 with reason.
- 2026-08-04 Cost guard: aggregates via count()/sum() over aiCalls rows of the local day — one row per finished call, INSERT-only audit trail; no cron, reset is implicit (next day's check reads a different day).

## Known Issues

- docs/research-Aquaman.md contains ~15 editorial artifacts (marked historical, non-authoritative); PRD v1.2 + TechDesign v1.1 supersede it
- z.ai Anthropic-compat: last verified Feb 2026 — re-verify before build start

## Completed

- [x] Planning v1 (research, PRD v1.1, TechDesign v1.0, agent config) — 2026-08-23
- [x] External plan review (docs/plan-review.md) — 2026-08-23
- [x] Review incorporated: PRD v1.2, TechDesign v1.1, AGENTS.md, agent_docs/* — 2026-08-23
- [x] Review follow-up verified & incorporated (ICS UID, missedSlots, gridded originalDueAt): PRD v1.3, TechDesign v1.2 — 2026-08-23
- [x] Phase 1: Vertical Slice (Next.js, Drizzle schema, health route, CI, Docker, TrueNAS-ready image) — 2026-08-23
- [x] Phase 1 code review fixes: agent docs restored, Docker boot path fixed, occurrence grid unified — 2026-08-23
- [x] Phase 2: Core Features (tank CRUD, schedules, dashboard, water tests, feeding) — 2026-08-23
- [x] Phase 2 code review fixes (#1–#20): DB CHECK constraints, NH3/NO2 range corrections, token 404s, tight-gap policy, non-root Docker — 2026-08-23
- [x] Phase 2 second-pass review fixes (#21–#27): navigation-in-root-layout regression, CVE upgrades (next/drizzle-orm), integration tests, water-value bounds, feed-cycle undo, action hardening — 2026-08-24
- [x] Phase 3: Calendar & ICS (`occurrenceDetailsInRange`, ICS feed route with token+rate-limit, month calendar view, token rotation UI) — 2026-08-24
- [x] Phase 4: AI Coach (`src/lib/ai/*`: config/cost-guard/context/client/proposal; `/api/coach` NDJSON streaming route; `applyProposal` approval action in `src/app/actions-ai.ts`; `/coach` UI + approval cards; AI status in /more; 122 tests green) — 2026-08-24
- [ ] Phase 5: Launch v0.1.0
- [ ] v1.1: MCP + OpenClaw
