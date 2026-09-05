# Memory

Keep short. Update after major decisions or completed phases. (Note: Claude Code
manages its own memory automatically — this file serves other agents and humans.)

## Current State

- **Current phase:** `v1.0.0` is tagged and shipped. Two features landed on
  `main` after it and are live in production: the product inventory
  (`docs/plan-produkt-lager.md`, migration `0007`) and drafting a new
  inventory product from a URL or pasted label text
  (`docs/plan-produkt-import-url.md`, stages 1 and 2, migration `0008`).
- **Current task:** none open.
- **Production** (since 2026-08-30): TrueNAS, container `ix-aquaman-aquaman-1`,
  data `/mnt/nvda/Aquaman`, host port 3100. Architecture + deploy runbook:
  `docs/How-It-Works.md`. Deploy order is **pull → hot backup → recreate** —
  do not stop the container to back it up, see the runbook for why.
- **Next:** stage 3 of the import plan — label PHOTO import — is built on
  `feat/label-photo-import` (2026-09-05, not yet merged/deployed). Photo is
  the default import tab, link and pasted text stay beside it (owner
  decision); `lib/import/prepare-image.ts` downscales to 1200 px and the
  photo is never stored. Feasibility was settled live on 2026-09-05 (the
  provider takes image blocks alongside tools and refuses unreadable ones).
- **Housekeeping on the NAS:** backups accumulate in `/mnt/nvda/` and are safe
  to delete once a production state is trusted.

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
- 2026-09-05 MCP writes deliberately do NOT trigger the proactive coach plan
  review — `requestPlanReview()` stays UI-only (`src/app/actions.ts`; the
  cores in `repo.ts` and the MCP tools never call it). Owner decision: an
  MCP/HA-written water test or maintenance log not starting a coach plan
  check is intended. Do not "fix" `src/lib/mcp/tools.ts` to add it.

## AI / Tooling Decisions

- 2026-08-23 Provider: Anthropic-compatible API (z.ai GLM default; Claude alternative) via @anthropic-ai/sdk + baseURL env
- 2026-08-23 Cost ceiling: AQUAMAN_AI_MAX_CALLS_PER_DAY=20 AND AQUAMAN_AI_MAX_TOKENS_PER_DAY≈200k; reset local midnight
- 2026-08-23 Eval prompts in agent_docs/testing.md (nitrate-high, NH3-at-pH-8, CO2-gasping, two-week-gap, injection-refusal)

## Decisions

- 2026-08-24 Phase 4 AI client: single code path via @anthropic-ai/sdk with baseURL env — one path for api.anthropic.com AND z.ai GLM. tool_use inputs accumulated from input_json_delta chunks, zod-validated on content_block_stop (reject, never repair). Usage from message_start (input) + message_delta (output) — the only events that carry real counts.
- 2026-08-24 Approval gate: `applyProposal` in src/app/actions-ai.ts is the ONLY write path for AI proposals. Re-validates proposal (zod) + live data (tank live, schedule active) at write time — the AI saw a snapshot, the write must survive a stale one. Partial application with per-change results (one stale id doesn't block valid rest). adjust bumps scheduleVersion (ICS SEQUENCE) and clears snooze (changed plan invalidates it).
- 2026-08-24 Coach route `/api/coach`: POST-only NDJSON stream, not token-gated (sits behind reverse proxy like every page). Input caps (question 2000 chars, history 12×4000), failure-only rate limit (30/h per IP, same limiter as ICS, key prefix coach:), guards BEFORE any provider call: no config → 503, budget → 429 with reason.
- 2026-08-04 Cost guard: aggregates via count()/sum() over aiCalls rows of the local day — one row per finished call, INSERT-only audit trail; no cron, reset is implicit (next day's check reads a different day).

- 2026-08-27 MCP (v0.4.0): `@modelcontextprotocol/server` 2.0 (SDK renamed from sdk@1.x) via its **WebStandardStreamableHTTPServerTransport in stateless JSON mode** (`sessionIdGenerator: undefined`, `enableJsonResponse: true`, per-request server instance) — fetch-native, no Node-req/res adapter needed; TechDesign's `AQUAMAN_MCP_TOKEN` env idea replaced by appSettings `mcpToken` (Settings UI can show/rotate, same as ICS)
- 2026-08-27 MCP security: entire endpoint bearer-gated — missing/wrong token → 404 (never 401), SHA-256+timingSafeEqual, failure-only rate limit `mcp:<ip>` 30/h; GET/DELETE → 405 (stateless has no SSE/session)
- 2026-08-27 MCP write tools (`add_water_test`, `log_maintenance`, `snooze_task`) reuse shared cores extracted into repo.ts (`logWaterTestCore`/`markScheduleDoneCore`/`snoozeScheduleCore`) — Server Actions are now thin wrappers; maintenance-log `source` enum widened to include `'mcp'` (TS-level only, column is plain TEXT — no migration); `ask_coach` shares the coach's two-tier budget + `purpose: 'coach'` and deliberately DROPS proposals (approval stays in-app)
- 2026-08-27 Windows dev: tests must `closeDb()` (close `db.$client`, clear `globalThis.__aquamanDb`) before `rmSync` of the temp data dir — open WAL handles → EPERM on Windows; use `os.tmpdir()`, never `/tmp`

## Known Issues

- docs/research-Aquaman.md contains ~15 editorial artifacts (marked historical, non-authoritative); PRD v1.2 + TechDesign v1.1 supersede it
- z.ai Anthropic-compat (`glm-5.3-flash`): re-verified live 2026-09-05 — tool
  use, and image blocks alongside tools, both work. Two standing quirks: the
  provider bills its `thinking` block against `max_tokens` (disable thinking
  and give it room, see `lib/ai/client.ts` and `lib/ai/product-draft.ts`), and
  a large image is both far more expensive and *worse* than a downscaled one.

## Completed

- [x] Product inventory (`docs/plan-produkt-lager.md`, migration `0007`) — shipped, in production
- [x] Product import from URL or pasted label text, stages 1+2 (`docs/plan-produkt-import-url.md`, migration `0008`) — shipped, in production 2026-09-05
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
- [x] Phase 4 review fixes — 2026-08-24, 132 tests green (10 new):
  - History bug (reproduced live against the real route before fixing): `coach-chat.tsx` sent its full, ever-growing `messages` array as history; `route.ts` hard-rejected (400) once it exceeded 12 entries — a real conversation died permanently after the 7th exchange, and the raw "invalid history" string rendered as if the AI said it. `MAX_HISTORY_MESSAGES` unified to one source (`config.ts`, was duplicated 3× with two different values, 10 vs 12); `route.ts` now truncates to the last N instead of rejecting (still rejects genuinely malformed entries or a >200-entry payload); `coach-chat.tsx` trims before sending too.
  - `client.ts`: `opts.signal` was accepted but never forwarded — the Anthropic call had no way to actually cancel on client disconnect (a dead `setTimeout`/`throwIfAborted` blob did nothing). Now passed as `RequestOptions.signal` on `client.messages.stream()`; verified against the real installed SDK (0.120.0) and with a test that fails on the pre-fix code.
  - `cost-guard.ts`: `checkBudget` only reads committed rows, so two near-simultaneous requests could both pass it before either's `recordAiCall` commits, exceeding `maxCallsPerDay` by one. Added `reserveCallSlot`/`releaseCallSlot` (in-memory, calls-only — token cost is unknowable ahead of the response, so it's not pre-reserved) wired into `route.ts` around the provider call.
  - `route.ts`: `send()`/`controller.close()` now swallow enqueue-after-disconnect errors instead of risking an unhandled exception when a client goes away mid-stream.
- [x] Phase 5: Launch v0.1.0 (export/import with roundtrip tests, statistics incl. metric 1a/1b, /api/export, /more overhaul, LICENSE/CONTRIBUTING/SECURITY, README launch guide, version.ts) — 2026-08-24
- [x] v0.2.0 — owner feedback round 1 (issues #30–#36): schedule details + endsOn, clickable/editable schedules everywhere (dashboard cards, tank page, calendar chips → edit dialog), feeding ± stepper with tank link, state-dependent Done/Later (never "Done" as default for future tasks), undoLastDone, water test preset chips + edit/delete, AI dosage proposals with verify-against-label warning + editable approval card — 2026-08-24
- [x] v0.2.1 + owner feedback round 2 (issues #37–#40) — 2026-08-25
- [x] v0.3.0 — Nocturne redesign (#43, rounds 1–5), proactive coach daily suggestions (#41), structured care plans (#42) — 2026-08-25
- [x] Post-v0.3.0 on main: proactive plan review (tank/water-test changes trigger coach plan check, 876cf38) + fishless-tank "no phantom feeding" coach fix (63c1b30) — 2026-08-25, 198 tests green
- [x] Windows dev fix: tests use os.tmpdir() + closeDb() before rmSync (open WAL handles → EPERM on Windows); suite green on Windows — 2026-08-27
- [x] v1.1: MCP + OpenClaw wiring — v0.4.0 (`/api/mcp` bearer-gated stateless Streamable HTTP; 7 tools per TechDesign §4.6 incl. ask_coach behind the shared AI budget; Settings UI with token copy/rotate; README OpenClaw config example; 21 new tests, 219 total green; live smoke-tested against `next start`) — 2026-08-27
- [x] v0.4.0 tagged and pushed; `v1.0.0` followed
- [ ] v2+: sensors, multi-user/OIDC, web push
