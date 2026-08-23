# AGENTS.md — Aquaman

## Project

- **What this is:** Self-hosted aquarium care & water tracking app with AI coach, flexible scheduling and ICS calendar feed
- **Who it is for:** Self-hosting aquarium hobbyists (analytical, dashboard-loving) — primary: owner with 2 freshwater tanks on TrueNAS SCALE
- **Current phase:** Foundation (vertical slice incl. Docker/CI/NAS first)

## Commands

Only the ones that are **not** guessable from the manifest — non-standard
scripts, required flags, environment setup.

- `npm run db:migrate` — applies Drizzle migrations to `data/aquaman.db`; required after pulling schema changes
- `npm run db:seed` — seeds default maintenance actions and water-parameter target ranges; idempotent
- `npx drizzle-kit generate` — required after editing `src/lib/db/schema.ts` BEFORE `db:migrate` sees changes (common miss)
- `npm test -- <path>` — single test file (Vitest)
- `docker compose up --build` — full local production-parity check before publishing the image

## Read first

1. `docs/PRD-Aquaman-MVP.md` (what we're building — source of truth; v1.3)
2. `docs/TechDesign-Aquaman-MVP.md` (how we're building it; v1.2)
3. `agent_docs/project_brief.md`
4. `agent_docs/tech_stack.md`
5. `agent_docs/code_patterns.md`
6. `agent_docs/testing.md`

`docs/research-Aquaman.md` is historical context, not authoritative — decisions
live in PRD/TechDesign. `docs/plan-review.md` documents why v1.2/v1.1 differ.

## Gotchas

**The highest-value section in this file.** Things that look safe and aren't.

### Scheduling core (bug hotspot #1)

- All date math lives in `src/lib/domain/scheduler.ts` + `dates.ts` as pure functions. Never compute due dates inline in components or routes — a timezone-naive `new Date().getDate()` makes tasks due "tomorrow" for 23:30 users. Always go through `nextDue()` / `startOfLocalDay()`.
- **`AQUAMAN_TIMEZONE` (default Europe/Berlin) governs everything "today"/"midnight"**: dashboard due, ICS day bucketing, `aiCalls.day`, AI limit reset. Use the `dates.ts` helpers (Intl-based), never `setHours(0,0,0,0)`.
- **`originalDueAt` is never moved.** Only human actions persist: Done → `lastDoneAt`, Snooze → `snoozedUntil`. Auto-Reschedule is a pure read-projection inside `nextDue()` — **never write it to the DB and never write to `maintenanceLogs` on reschedule** (falsifies care history + poisons AI context).
- `originalDueAt` gets its preferred-weekday adjustment **once, at creation**: `nextPreferredDay(lastDoneAt + intervalDays)`. Adjusting later would move it (breaks the contract); not adjusting at all puts the target on a day the task may not be done, making the user behind by construction.
- **There is no `rescheduleCount` column.** Use `missedSlots(schedule, today)` — count of preferred weekdays in `(originalDueAt, today]`. A stored counter is impossible here: `plannedFor` is never persisted, and writing one would break "auto-reschedule never writes". Same number feeds the "interval too tight?" hint (≥ 3), success metric 1b, and the ICS `SEQUENCE`.
- `nextPreferredDay(date, mask)` is **inclusive** — if `date` is already a preferred day it returns `date`. Exclusive would push an overdue weekend task a full week out. Mask `0` is rejected by zod and defensively treated as "every day" so the search can never loop forever.
- **Weekday mask is Bit 0 = Mon, but `Date.getDay()` returns 0 = Sun.** Never compare them directly — go through `localWeekdayIndex(date, tz)` in `dates.ts`. Guaranteed off-by-one otherwise.
- **ICS `UID` is keyed on `originalDueAt`, never on the planned date.** `plannedFor` drifts every day a task stays open (it is a projection over `today`), so a date-keyed UID would churn daily and Google would delete+recreate instead of moving the event — losing the user's reminders and flashing duplicates during its non-transactional refresh. `DTSTART` moves, `UID` stays, `SEQUENCE = scheduleVersion + missedSlots`, `DTSTAMP = schedule.updatedAt` (never `now`, or the feed is never byte-identical).
- Only the **current** occurrence is projected. Future ones sit on the fixed grid from `originalDueAt` (`occurrencesInRange()`) — chaining them off `plannedFor` would drag the whole 90-day calendar along on every day of backlog.
- `snoozedUntil` always wins over interval math for that occurrence — don't "helpfully" recompute.
- SQLite has no arrays/jsonb: JSON fields are `text({mode:'json'})`, weekdays are a 7-bit integer mask (Bit 0 = Mon … Bit 6 = Sun).
- Feeding is a Daily Habit (dashboard checkbox, `maintenanceLogs` entry) — NOT a schedule, NOT an ICS event.

### Next.js / build traps

- SQLite runs WAL via better-sqlite3 (synchronous). Use the singleton from `src/lib/db/index.ts`; never open per-request connections. `SQLITE_BUSY` during dev hot reload + parallel migrate → restart dev server.
- `next.config.ts` must keep `output: 'standalone'` and `serverExternalPackages` including better-sqlite3 and sharp — otherwise the bundler tries to pack native modules and the Docker build breaks.
- Docker build stage and runner stage MUST share the same base image/arch — better-sqlite3 and sharp compile native binaries per platform (NAS may be arm64).
- Healthcheck uses `node -e "fetch(...)"` — `wget` does NOT exist in `node:*-slim` (Debian), only Alpine/busybox.
- Photo upload needs `experimental.serverActions.bodySizeLimit: '6mb'` — Next.js default is 1 MB and silently fails larger uploads.
- The uploads route (catch-all segment) takes a URL path → normalize + reject `..` (path traversal), Content-Type whitelist.

### AI

- Provider is Anthropic-compatible but NOT necessarily Anthropic: `AQUAMAN_AI_BASE_URL` may point at z.ai. Never hardcode `api.anthropic.com`. **Verify current z.ai compatibility before build start (research data from Feb 2026).**
- Structured output (calendar proposals) only via tool-use + zod — never parse free-text JSON; malformed → reject, never repair.
- Streaming cost counting: read `usage` from the FINAL stream event, otherwise you count zero tokens.
- Cost ceiling is two-tier: `AQUAMAN_AI_MAX_CALLS_PER_DAY` AND `AQUAMAN_AI_MAX_TOKENS_PER_DAY` — enforce both; reset at local midnight (`AQUAMAN_TIMEZONE`).
- AI answers/tool results are untrusted input. They render as text and write only through validated Server Actions with an explicit human approval step (the approval gate IS the security boundary — there is no other auth in v1).

### Security / endpoints

- ICS route (`/api/calendar.ics`): GET-only, token in query, invalid token → **404 (not 401)**, rate-limit 30 failed attempts/IP/h → 429, `Cache-Control: max-age=3600`. Google refreshes ~daily — don't hammer.
- Token compare: **SHA-256 both sides first, then `crypto.timingSafeEqual`** — it throws `RangeError` on differing buffer lengths, so a wrong-length token would 500 (and leak the length).
- Tokens: `crypto.randomBytes(24).toString('base64url')`; rotation via Settings.
- docker-compose binds ports as `127.0.0.1:3000:3000` (or no publish + shared Docker network) — a plain `3000:3000` lets LAN users bypass reverse-proxy auth. Keep it that way.
- Soft-delete only: tanks/schedules flagged, never row-deleted (logs and water tests reference them; AI reads history).

### Misc

- All UI strings via next-intl keys (`src/i18n/en.json`, `de.json` from end of Phase 2). A hardcoded English string breaks the German locale silently.
- `.claude/skills/` is canonical; `.agents/skills/` mirrors it — update BOTH or only `.claude` and sync, never let them drift.

## Protected areas — ask before changing

- `.env*`, secrets, credentials, private logs
- `.github/workflows/`, deployment, infrastructure, `Dockerfile`, `docker-compose.yml`
- existing database migrations
- auth, payments, billing, production email/send flows
- AI provider credentials, tool permissions, token generation/rotation logic
- `src/lib/domain/*` scheduling algorithms without accompanying tests

**Never print, commit, or transmit secrets, tokens, private logs, or production
data.** Never delete files, rewrite large areas, or change
infrastructure/auth/billing/migrations without approval.

## AI features

- **Model can see:** user-owned data only — tank profiles (incl. tankState), water tests incl. calculated NH3, maintenance logs, backlog (originalDueAt-based), missedSlots, AI usage counters
- **Never send:** API keys, ICS/MCP tokens, `.env` contents, server paths
- **AI can do:** draft (propose schedule changes, interval adjustments), read context; CANNOT write — every proposal lands in an approval UI and is written only by the user's confirm action
- **Needs approval:** all schedule/calendar writes, interval changes, maintenance-plan generation; (v1.1) MCP write tools additionally require the bearer token
- **How to verify behavior:** run the eval prompts in `agent_docs/testing.md` (nitrate-high, NH3-at-pH-8, CO2-gasping, two-week-gap, injection-refusal); check `aiCalls` reflects calls+tokens; verify proposal renders in approval UI and is NOT in DB before confirm
- **Fallback:** no key / API error / daily limit → Coach shows "AI offline — core features fully working"; scheduling, tracking, ICS remain functional; two-tier limit pauses AI until local midnight

## Done means

Report: files changed · commands run · test/build/device results · AI eval
evidence if applicable · remaining risks · rollback notes if relevant.

---

**When this file gets long, split it:** task-specific procedures →
`.claude/skills/<name>/SKILL.md` (description stays resident); directory
conventions → `<subdir>/CLAUDE.md`. Universal constraints and safety
prohibitions stay here — never move a "never do X" rule somewhere it might
not be loaded.
