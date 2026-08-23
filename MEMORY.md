# Memory

Keep short. Update after major decisions or completed phases. (Note: Claude Code
manages its own memory automatically — this file serves other agents and humans.)

## Current State

- Current task: Plan-Review eingearbeitet (PRD v1.2, TechDesign v1.1, agent_docs aktualisiert) — wartet auf Owner-Freigabe für Phase 1
- Current phase: Foundation (pre-build; Phase 1 = vertical slice incl. Docker/CI/NAS)
- Next step: Owner genehmigt → Phase 1: Vertical Slice (Next.js + Schema + Health + CI + TrueNAS-Deployment)
- Blocked by: none

## Decisions

- 2026-08-23 Next.js 15 monolith (App Router) + SQLite/Drizzle — one container, one artifact, best AI-codegen support for Level-A owner
- 2026-08-23 Anthropic-compatible AI via `AQUAMAN_AI_BASE_URL` (durchgängiges Präfix) — one code path for z.ai GLM and Claude; re-verify z.ai docs before build start
- 2026-08-23 Flexible scheduling core: `originalDueAt` never moves (honest backlog) / `plannedFor` read-projection (clean plan); auto-reschedule NEVER writes DB or logs; rescheduleCount ≥ 3 → "interval too tight?"
- 2026-08-23 Feeding = daily habit (dashboard checkbox), NOT a schedule, NOT in ICS
- 2026-08-23 SQLite-typing: text({mode:'json'}) + 7-bit weekday mask (no jsonb/int[])
- 2026-08-23 `APP_TIMEZONE` (default Europe/Berlin) governs all today/midnight logic via Intl helpers
- 2026-08-23 ICS: expanded VEVENTs, deterministic UID `{scheduleId}-{plannedDateISO}@aquaman`, byte-identical feed test; invalid token → 404; rate limit
- 2026-08-23 MCP moved to product v1.1 (owner decision after plan review); fully bearer-gated
- 2026-08-23 Two-tier AI cost ceiling (calls AND tokens); streaming usage from final event
- 2026-08-23 NH3 calculated from NH4+pH+temp (Emerson 1975), evaluated instead of raw NH4; NO2 target 0 established; tankState cycling|established
- 2026-08-23 Docker in Phase 1 as vertical slice (avoid late deployment surprises); ports 127.0.0.1-only
- 2026-08-23 Timeline corrected: 6–8 weeks part-time (was 2–4, review called it unrealistic)

## AI / Tooling Decisions

- 2026-08-23 Provider: Anthropic-compatible API (z.ai GLM default; Claude alternative) via @anthropic-ai/sdk + baseURL env
- 2026-08-23 Cost ceiling: AQUAMAN_AI_MAX_CALLS_PER_DAY=20 AND AQUAMAN_AI_MAX_TOKENS_PER_DAY≈200k; reset local midnight
- 2026-08-23 Eval prompts in agent_docs/testing.md (nitrate-high, NH3-at-pH-8, CO2-gasping, two-week-gap, injection-refusal)

## Known Issues

- docs/research-Aquaman.md contains ~15 editorial artifacts (marked historical, non-authoritative); PRD v1.2 + TechDesign v1.1 supersede it
- z.ai Anthropic-compat: last verified Feb 2026 — re-verify before build start

## Completed

- [x] Planning v1 (research, PRD v1.1, TechDesign v1.0, agent config) — 2026-08-23
- [x] External plan review (docs/plan-review.md) — 2026-08-23
- [x] Review incorporated: PRD v1.2, TechDesign v1.1, AGENTS.md, agent_docs/* — 2026-08-23
- [ ] Phase 1: Vertical Slice
- [ ] Phase 2: Core Features
- [ ] Phase 3: Calendar & ICS
- [ ] Phase 4: AI Coach
- [ ] Phase 5: Launch v0.1.0
- [ ] v1.1: MCP + OpenClaw
