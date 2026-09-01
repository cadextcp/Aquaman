# How AquaMon Works — Architecture & Operations

> One-page mental model + operations runbook. Product scope lives in
> [`PRD-Aquaman-MVP.md`](PRD-Aquaman-MVP.md), design decisions in
> [`TechDesign-Aquaman-MVP.md`](TechDesign-Aquaman-MVP.md), user-facing install
> in the [README](../README.md). This file is the "how do I reason about and
> operate the thing" page.

## Stack & shape

- **Next.js 15 App Router monolith** (React 19, Tailwind 4). Mutations go
  through Server Actions; plain API routes exist only where a protocol demands
  it (`/api/calendar.ics`, `/api/coach`, `/api/mcp`, `/api/export`,
  `/api/health`).
- **SQLite via better-sqlite3 + Drizzle ORM.** Exactly one database file at
  `$AQUAMAN_DATA_DIR/aquaman.db` (default `./data`), plus an uploads folder in
  the same dir. Zero external services.
- **Docker:** one container, non-root user. `CMD` runs migrations
  (`scripts/migrate.ts`, idempotent) and then the standalone `server.js`.
  `npm run db:seed` is a dev/legacy step and is **not** part of the container
  boot — a fresh install works without it.
- DB pragmas (src/lib/db/index.ts): `journal_mode = WAL`,
  `foreign_keys = ON`, `busy_timeout = 5000`.

## Data model — 7 tables (`src/lib/db/schema.ts`)

| table | role |
| --- | --- |
| `tanks` | core entity; soft delete via `deleted_at`; per-parameter `param_overrides` JSON |
| `schedules` | the plans (water changes, fertilizing, …); FK → tanks; `active` flag = soft delete |
| `maintenance_logs`, `water_tests`, `feed_logs` | history; FK → tanks |
| `ai_calls` | INSERT-only ledger: one row per finished AI call, feeds the daily budget |
| `app_settings` | key-value store: global settings (`appSettings.v1`), AI provider config (`aiSettings.v1`, **never** the API key), ICS token, MCP token, daily-suggestion cache |

Conventions: all timestamps are ISO-8601 UTC TEXT; weekdays are a 7-bit mask
with bit 0 = Monday (use `localWeekdayIndex()` from `domain/dates.ts`, never
`Date.getDay()`); JSON lives in TEXT columns via `text({ mode: "json" })`.

**Reference ranges come from code, not the DB**: `FRESHWATER_RANGES` /
`SALTWATER_RANGES` in `src/lib/domain/ranges.ts`, selected by
`tank.water_type`; per-tank `param_overrides` win. (The `freshwaterRanges` /
`saltwaterRanges` / `defaultActions` rows that `db:seed` writes are legacy
compat — nothing reads them at runtime.)

**Foreign keys have no cascade.** Manual deletes must go children-first:
`feed_logs → water_tests → maintenance_logs → schedules → tanks`.

## Scheduling core (the heart)

- `originalDueAt` is weekday-gridded at creation and **never moves** (honest
  backlog). `plannedFor` is a read-time projection (clean plan). Auto-
  reschedule never writes to the DB or logs.
- `missedSlots()` is a pure formula (no stored counter); ≥ 3 → "interval too
  tight?" indicator.
- Snooze is user-only; after catching up the tight-gap policy applies
  (`fixed` keeps the grid, `suppress` skips the first too-soon grid point;
  default `suppress` @ 50 %, configurable in *More*).
- **ICS:** one occurrence-expansion algorithm (`occurrenceDetailsInRange`)
  shared by dashboard, calendar UI and `/api/calendar.ics`. Event identity is
  `UID = {scheduleId}-{originalDueAt}@aquaman` — snoozing/rescheduling moves
  `DTSTART` instead of duplicating; `SEQUENCE = scheduleVersion + missedSlots`.
  The feed is token-gated (token in `app_settings`, shown under *More*).

## AI coach (optional — app works fully without a key)

- Any Anthropic-compatible API via `AQUAMAN_AI_BASE_URL` / `AQUAMAN_AI_API_KEY`
  / `AQUAMAN_AI_MODEL` (works with z.ai GLM and Anthropic). Provider/model/key
  can also be set in *More* (`aiSettings.v1` + a key file in `DATA_DIR`, see
  `src/lib/ai/key-store.ts`); the key is never written to the DB or exports,
  and takes precedence over the env var when set.
- Two-tier daily budget — calls **and** tokens — resets at local midnight
  (`AQUAMAN_TIMEZONE`), enforced by aggregating `ai_calls`; the ledger is
  INSERT-only.
- Output budget per call: 4096 tokens, temperature 0.3 (`src/lib/ai/client.ts`).
  Reasoning models bill their invisible "thinking" against `max_tokens` — at
  the old 1024, real coach questions came back with zero visible text (empty
  bubble). The z.ai path additionally sends `thinking: {type: "disabled"}`
  (their Anthropic-compat layer accepts it, verified live; api.anthropic.com
  would reject that shape, so it is gated to z.ai base URLs).
- The `propose_schedule` tool schema mirrors the zod schema's required fields
  (`kind, intervalDays, tankId, actionType, preferredDays`) — pinned by
  `tests/proposal-schema.test.ts`. A drift between the two schemas made the
  model omit `preferredDays` and every create-proposal failed validation.
- `/api/coach`: POST-only NDJSON stream; guards run **before** any provider
  call (503 unconfigured, 429 over budget); failure-only rate limit 30/h/IP.
- **Approval gate:** `applyProposal` (`src/app/actions-ai.ts`) is the only
  write path for AI proposals. It re-validates the proposal against live data
  at write time and applies changes partially (one stale id doesn't block the
  rest). The AI never writes on its own.

## MCP endpoint (v0.4.0 — for OpenClaw & co.)

- `POST /api/mcp`, MCP over stateless JSON (no SSE/session). The whole
  endpoint is bearer-gated via the `mcpToken` in `app_settings` (shown/rotated
  under *More*); missing/wrong token → **404**, never 401; failure-only rate
  limit 30/h/IP.
- Read tools expose tank state and recent water tests. Write tools
  (`add_water_test`, `log_maintenance`, `snooze_task`) reuse the exact same
  cores as the Server Actions (`repo.ts`) and set `source: 'mcp'`. **Nothing
  can be deleted or rewritten remotely.** `ask_coach` shares the coach budget
  and drops proposals (approval stays in-app).

## v1 REST API (`/api/v1/*` — for the wall display, HA & scripts)

- Generic machine API for non-Next clients — built for the ESPHome aquarium
  wall display (repo `../haDisplay/`), consumed through a Home Assistant
  bridge (`rest:` sensors + `rest_command:`/`script:`) since ESPHome has no
  HTTP client of its own. Equally usable by curl/Scripts.
- **Auth:** bearer-gated via `apiGate` — same 404-not-401/429 contract as
  `/api/mcp`, but its **own token** (shown/rotated under *More* → REST API)
  and its own rate-limit scope, so rotating the MCP token never locks the
  API out and vice versa.
- **Discovery:** Swagger UI at `/api/v1/docs`, machine-readable OpenAPI at
  `/api/v1/openapi.json` (both public GETs).
- **Endpoint groups:** `tanks` (list/CRUD, per-tank `status`, `actions`
  history, `feedings`, `water-tests`), `schedules` (list/create, get/
  patch/delete, `done`/`snooze`/`undo`), `water-tests` (create, patch/
  delete), read-only `tasks` + `water-parameters`, and `POST /actions` as
  the generic event sink.
- **Standard-events catalog:** `actionType` on `POST /api/v1/actions` must
  be one of `LOGGABLE_ACTION_TYPES` from `src/lib/domain/action-types.ts`
  — the single source of truth shared by schedules, logs, UI, MCP and this
  API. Anything else → 400 with the valid keys in the message. `feed` is
  deliberately rejected there with a pointer to `POST /tanks/{id}/feedings`
  (`delta: 1|-1`), because feeding is a daily counter (`feed_logs`), not a
  timestamped log row.
- **Writes** go through the same cores as Server Actions (`logActionCore`
  etc.) and set `source: 'api'` in `maintenance_logs`. When a call omits
  `detailData`, `logActionCore` inherits the structured details (e.g.
  "Fe 10 ml") from the tank's matching active plan — a bare
  `{actionType: "fertilize"}` log reads exactly like a dashboard tick-off.

## Security model

Designed to sit behind a reverse proxy that does auth; the container binds
loopback-only in dev (`127.0.0.1:3000:3000`). Tokens (ICS, MCP) are compared
as SHA-256 with `timingSafeEqual` (never raw — avoids length leaks). Container
runs as non-root `node`.

## Production deployment — TrueNAS runbook

Instance: TrueNAS host `truenas` (LAN), deployed as a TrueNAS
Docker app. SSH works with key auth as `alex`; docker on the host needs sudo.

- Container: `ix-aquaman-aquaman-1`, image `ghcr.io/cadextcp/aquaman:main`
- Data: bind mount `/mnt/nvda/Aquaman` → `/app/data` (SQLite + uploads)
- Port: host **3100** → container 3000 (reverse proxy in front)
- Health: `curl http://truenas:3100/api/health` → 200;
  status: `docker ps --filter name=aquaman`; logs:
  `docker logs ix-aquaman-aquaman-1`
- Every container start runs migrations — idempotent. Ranges/catalog ship
  with the image code, so pulling a new image brings range corrections
  automatically.
- **Backup:** stop container → `cp -a /mnt/nvda/Aquaman /mnt/nvda/<name>` →
  start. Always copy `aquaman.db` + `-wal` + `-shm` together, and only while
  the container is stopped.
- **Data reset for a fresh production start** (done 2026-08-30): stop
  container → run a one-off container with the image's own better-sqlite3:
  `docker run --rm -v /mnt/nvda/Aquaman:/app/data ghcr.io/cadextcp/aquaman:main node -e '<script>'`
  that DELETEs in FK-safe order (`feed_logs`, `water_tests`,
  `maintenance_logs`, `schedules`, `tanks`, `ai_calls`) while **keeping
  `app_settings`** (tokens + settings), then `VACUUM`, then start the app
  container and verify health + row counts. Pre-wipe backup of that first
  production reset: `/mnt/nvda/Aquaman-backup-20260830` (safe to delete once
  production data is trusted).

## Windows dev notes

- `npm run dev` = `db:ensure` (migrate) + `next dev`. Tests: `npm run test`.
- Tests must `closeDb()` before `rmSync` of the temp data dir — open WAL
  handles cause `EPERM` on Windows — and must use `os.tmpdir()`, never `/tmp`.
