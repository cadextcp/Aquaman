# Tech Stack

Last verified: 2026-08

## Stack

| Area | Choice | Notes |
|------|--------|-------|
| Frontend | Next.js 15 (App Router) + React 19 + TypeScript | One artifact for UI + API; Server Components keep client JS small; best AI-codegen support for Level-A owner |
| Backend | Next.js API Routes + Server Actions (Node.js runtime) | Domain logic in `src/lib/domain/*` shared by routes, actions, and (v1.1) MCP tools — API-first for future sensors |
| Database | SQLite + Drizzle ORM (better-sqlite3) | Local == production; DB at `data/aquaman.db` in volume `/app/data`; WAL mode; JSON fields as `text({mode:'json'})`, weekdays as 7-bit int mask (SQLite has no arrays/jsonb) |
| Auth | None in v1 (reverse-proxy auth documented; ICS token-gated; MCP bearer-gated since v0.4.0) | Single-user behind reverse proxy; token endpoints use timingSafeEqual, 404-on-invalid, rate limit 30/h |
| Styling | Tailwind CSS + shadcn/ui (dark aqua theme, mobile-first) | Bottom-nav mobile, sidebar ≥ lg; touch targets ≥ 44px; all strings via next-intl keys (en first, de from end of Phase 2) |
| Deployment | Docker (multi-stage, standalone) on TrueNAS SCALE via ghcr.io | Ports `127.0.0.1:3000:3000` only; CI: lint → typecheck → test → build → push; vertical slice deployed in Phase 1 |
| Timezone | `AQUAMAN_TIMEZONE` (default Europe/Berlin) via Intl-based helpers in `src/lib/domain/dates.ts` | Governs "today", ICS day bucketing, aiCalls.day, AI limit reset; weekday mask is Bit 0 = Mon while `getDay()` is 0 = Sun — always via `localWeekdayIndex()` |

## Commands

- Setup: `npm ci && npm run db:migrate && npm run db:seed`
- Dev: `npm run dev`
- Test: `npm test` (all) · `npm test -- <path>` (single file)
- Typecheck: `npm run typecheck`
- Lint/format: `npm run lint`
- Build: `npm run build`
- Browser/device check: `npm run dev` → http://localhost:3000 — verify dashboard + tank flow in mobile viewport (DevTools iPhone) and desktop; owner verifies on real phone before release

## AI Runtime

- Provider/runtime: Anthropic-compatible HTTP API via `@anthropic-ai/sdk` with `baseURL` from `AQUAMAN_AI_BASE_URL` — supports Anthropic Claude AND z.ai GLM (`https://api.z.ai/api/anthropic`) with one code path. **Re-verify z.ai compatibility against current docs before build start (last check Feb 2026).**
- Model can see:
  - Public: none
  - User-owned: tank profiles (incl. tankState), plants/fish, equipment, water test history incl. calculated NH3, maintenance logs, backlog (originalDueAt-based), missedSlots
  - Never send: API keys, ICS/MCP tokens, `.env` values, server paths
- Tools/actions: read + draft (structured schedule proposals via tool-use + zod; malformed → reject, never repair); writes only via user-confirmed Server Actions
- Approval gates: every AI schedule/interval proposal requires explicit user confirmation in UI; (v1.1) MCP write tools require bearer token
- Retention/training setting to verify: provider defaults documented in README; acceptable for private single-user use
- Fallback: no key / API failure / limit → "AI offline — core features fully working"; two-tier ceiling: `AQUAMAN_AI_MAX_CALLS_PER_DAY` (20) AND `AQUAMAN_AI_MAX_TOKENS_PER_DAY` (~200k); streaming usage read from FINAL stream event; reset at local midnight (AQUAMAN_TIMEZONE); `aiCalls` keeps provider+model so cost estimates survive a model switch

## Important Patterns

- Data fetching: React Server Components query via `src/lib/db` repository functions; never fetch own API from RSC
- State management: server state via RSC + `revalidatePath`; client state only charts/forms/coach chat
- Forms/validation: react-hook-form + zod; same schema client and Server Action
- Error handling: zod boundaries; user-safe errors; AI failures → "AI offline", never empty UI
- Logging/monitoring: `/api/health` for Docker healthcheck; `aiCalls` as AI telemetry; no external telemetry
- Scheduling: `nextDue()` pure function — `originalDueAt` is weekday-gridded once at creation and never moves (honest backlog), `plannedFor` is a read-projection (incl. auto-reschedule); only human actions persist (Done, Snooze). `missedSlots(schedule, today)` replaces any stored reschedule counter. `occurrencesInRange()` expands the 90-day horizon: current occurrence projected, future ones on the fixed grid
- ICS: expanded VEVENTs (no RRULE), UID `{scheduleId}-{originalDueAtISO}@aquaman` (keyed on the immutable target date, so snooze/reschedule move `DTSTART` instead of replacing the event), `SEQUENCE = scheduleVersion + missedSlots`, `DTSTAMP = schedule.updatedAt` (not `now`), sorted output → byte-identical feed for identical inputs
- NH3: calculated from NH4-total + pH + temp (Emerson et al. 1975) in `ranges.ts`; NH3 (not NH4 raw) is evaluated
- Docker: build and runner stages share base image/arch (native modules better-sqlite3 + sharp); healthcheck via `node -e fetch(...)` (no wget in slim images); `bodySizeLimit: '6mb'` for photo uploads
