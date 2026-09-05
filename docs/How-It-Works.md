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

## Data model — 8 tables (`src/lib/db/schema.ts`)

| table | role |
| --- | --- |
| `tanks` | core entity; soft delete via `deleted_at`; per-parameter `param_overrides` JSON; free-text `feeding_plan` markdown (prose — deliberately NOT a schedule, see the feeding-plan section) |
| `schedules` | the plans (water changes, fertilizing, …); FK → tanks; `active` flag = soft delete |
| `products` | the inventory: fertilizers and foods the user owns, install-wide (no FK to a tank). Fertilizers carry `nutrients` keyed by the `NUTRIENTS` catalog; soft delete via `deleted_at`, with a partial unique index on live `(kind, name)` |
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

**Plans reference a food by NAME, not by id** (`detailData.foods` is keyed by
the product name). That is what let migration `0007` lift `tanks.foods` into
`products` without touching a single plan — and why renaming a product
re-keys ACTIVE plans (`updateProductCore`) while history keeps the old name.

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
- The `propose_schedule` tool schema mirrors the zod schema's per-kind
  required fields — `intervalDays` deliberately lives in the create/adjust
  branches only, because `kind=set_feeding_plan` (a full feeding-plan
  rewrite) has no interval — pinned by `tests/proposal-schema.test.ts`. A
  drift between the two schemas made the model omit `preferredDays` and every
  create-proposal failed validation.
- `/api/coach`: POST-only NDJSON stream; guards run **before** any provider
  call (503 unconfigured, 429 over budget); failure-only rate limit 30/h/IP.
- **Approval gate:** `applyProposal` (`src/app/actions-ai.ts`) is the only
  write path for AI proposals. It re-validates the proposal against live data
  at write time and applies changes partially (one stale id doesn't block the
  rest). The AI never writes on its own.
- Coach answers render as markdown in the chat bubbles (react-markdown +
  `remark-gfm` for tables + `remark-breaks` so plain-prose answers keep their
  line structure). No `rehype-raw`: model output stays escaped text, never
  HTML.

## Feeding plan (per tank, markdown)

`tanks.feeding_plan` holds the owner's free-text feeding regime — which food
on which days, fasting days, portion rules. Design and rationale:
`docs/plan-fuetterungsplan.md`. Two things it deliberately is NOT:

- **Not a schedule.** Feeding is the daily counter (`feed_logs`); a feeding
  *plan* as a schedule row was removed by migration `0006` as unsatisfiable
  by construction. This text never ticks anything off, never reaches the ICS
  feed, and `missedSlots()` never counts it.
- **Not AI-written.** Two coach surfaces, both gated: the "Suggest a feeding
  plan" button (`POST /api/feeding-plan/draft` → `lib/ai/feeding-plan-draft.ts`,
  one tool call grounded in the tank's coach context) drops a draft into the
  EDITOR — the manual Save is the approval; and in `/coach`,
  `kind=set_feeding_plan` proposals go through the normal `applyProposal`
  gate with an editable card. Both must name foods by their EXACT shelf names
  (owner-reported bug: "Granulat" was unmappable). One write path for humans
  and AI alike: `setTankFeedingPlanCore` (`repo.ts`), deliberately outside
  `tankInputSchema` so the full-replace profile edit can't wipe the field.

## MCP endpoint (v0.4.0 — for OpenClaw & co.)

- `POST /api/mcp`, MCP over stateless JSON (no SSE/session). The whole
  endpoint is bearer-gated via the `mcpToken` in `app_settings` (shown/rotated
  under *More*); missing/wrong token → **404**, never 401; failure-only rate
  limit 30/h/IP.
- Read tools expose tank state, recent water tests and the product inventory
  (`get_products`). Write tools
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
  delete), `products` (list/create, get/patch/delete — the inventory,
  install-wide so there is no tank in the path), read-only `tasks` +
  `water-parameters`, and `POST /actions` as the generic event sink.
- **Standard-events catalog:** `actionType` on `POST /api/v1/actions` must
  be one of `LOGGABLE_ACTION_TYPES` from `src/lib/domain/action-types.ts`
  — the single source of truth shared by schedules, logs, UI, MCP and this
  API. Anything else → 400 with the valid keys in the message. `feed` is
  deliberately rejected there with a pointer to `POST /tanks/{id}/feedings`
  (`delta: 1|-1`), because feeding is a daily counter (`feed_logs`), not a
  timestamped log row. `POST /schedules` rejects it for the same reason:
  `SCHEDULABLE_ACTION_TYPES` is the catalog minus `feed`, since nothing that
  records a feeding writes `schedules.last_done_at` — a feed plan could never
  be closed. "Last fed" is served by `GET /tanks/{id}/status` instead
  (`actions.feed.lastDoneDay` / `daysAgo`, straight from `feed_logs`).
- **Writes** go through the same cores as Server Actions (`logActionCore`
  etc.) and set `source: 'api'` in `maintenance_logs`. When a call omits
  `detailData`, `logActionCore` inherits the structured details (e.g.
  "Fe 10 ml") from the tank's matching active plan — a bare
  `{actionType: "fertilize"}` log reads exactly like a dashboard tick-off.

## Product import (`/api/inventory/import`)

Adding a product to the shelf used to mean distilling a label or a shop page
into four fields by hand. The create form now opens with a **photo** row (the
bottle is usually in the hand while the shelf is where the typing happens);
link and pasted text sit beside it as switches. The result is a DRAFT in the
form fields, and a person still presses Save.
Design and rationale: `docs/plan-produkt-import-url.md`.

The chain, in this order on purpose:

```
URL ─▶ url-guard ─▶ fetch-page ─▶ extract ─▶ budget ─▶ model ─▶ zod ─▶ form fields
       (SSRF)       (403/timeout) (thin?)    (limit)                    (human saves)

photo ──────────▶ prepare-image ─▶ budget ─▶ model ─▶ zod ─▶ form fields
                  (decode+downscale) (limit)                   (human saves)
```

Everything before the model is decided without spending a token, so a blocked
shop or a JavaScript shell can never turn into an invented product. Modules:

| File | Job |
|---|---|
| `lib/import/url-guard.ts` | Scheme, credentials, local suffixes, and every private/loopback/link-local/CGNAT range — in v4, v6 and v4-mapped-v6 spellings. Resolves DNS and rejects if ANY answer is private |
| `lib/import/fetch-page.ts` | 8 s, 2 MB, HTML only, 3 hops. Redirects are followed **manually** so each hop is re-checked by the guard |
| `lib/import/extract.ts` | HTML → ~3 k characters of product text (measured: 197 KB of one shop, 85 KB of another). Noise stretches close on the next wanted heading, because one shop prints "similar products" above the description |
| `lib/import/prepare-image.ts` | The photo path: type judged by DECODING (never name/Content-Type), 5 MB byte cap, 120 MP pixel cap against decompression bombs, EXIF-aware downscale to 1200 px — measured: the phone original cost 5× the tokens AND drafted worse. HEIC decodes via sharp |
| `lib/ai/product-draft.ts` | One tool (`draft_product`), the editorial rules, zod. `kind` is an input, so a food page cannot come back carrying nutrients. `draftProductFromImage` sends the prepared JPEG as an image block next to the same tool contract; the debug log swaps the base64 for its size so one call can't drop megabytes into SQLite |

**This is the app's only outbound HTTP call** other than the AI provider —
see `SECURITY.md`.

Two behaviours worth knowing before changing anything here. A model answer
that overshoots 600 characters is cut at a sentence boundary, but an
over-long **dosing instruction is dropped entirely** rather than truncated —
half a feeding instruction is worse than none. And "no tool call" is the
model's way of saying *there is no product here*; do not force `tool_choice`,
or a privacy policy becomes a fish food.

Provenance (migration `0008`): an entry created from a URL records
`source_url` and a server-stamped `source_fetched_at`, shown as "Taken from
<host> on <date>". Editing never changes them, so the line cannot be attached
to something typed by hand.

The paste fallback takes the same path minus fetch and extraction. It exists
because shops block server-side retrieval often, and because a tin in your
hand has no URL at all. The photo path also skips the fetch (no outbound
request → no SSRF surface) and never writes the image anywhere: decode,
downscale, send, discard — there is no upload folder and no DB column, and
`source_url` stays empty because a photo has no verifiable source.

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
- **Backup — do NOT stop the container for this.** SQLite can snapshot itself
  while it is being written to, so the stop the old procedure demanded bought
  nothing and cost availability:

  ```bash
  # consistent snapshot of the LIVE database, app keeps serving
  sudo docker run --rm -v /mnt/nvda/Aquaman:/app/data ghcr.io/cadextcp/aquaman:main \
    node -e "new (require('better-sqlite3'))('/app/data/aquaman.db',{readonly:true}) \
             .exec(\"VACUUM INTO '/app/data/backup-<name>.db'\")"
  sudo mv /mnt/nvda/Aquaman/backup-<name>.db /mnt/nvda/Aquaman-backup-<name>.db
  ```

  The snapshot is a single file with the WAL already folded in — no `-wal` /
  `-shm` to keep together. It has to be written **inside** the bind mount and
  moved afterwards: the container runs as non-root `node` and cannot write to
  `/mnt/nvda` itself. Verify it before trusting it (open it read-only and count
  `__drizzle_migrations` plus a table or two).

  `cp -a` of the whole directory is still correct, but only with the container
  stopped, and only for `aquaman.db` + `-wal` + `-shm` copied together.

- **Deploy order: pull → backup → recreate.** Pull first, while the app is
  still up, so a failure at that step costs nothing:

  ```bash
  sudo docker pull ghcr.io/cadextcp/aquaman:main
  # …backup as above…
  cd /mnt/.ix-apps/app_configs/aquaman/versions/<v>/templates/rendered
  sudo docker compose -p ix-aquaman up -d aquaman   # -p is mandatory
  ```

  `compose up -d` stops and starts in one step, so the app is never left
  stopped waiting for a second command. That is not hypothetical: on
  2026-09-05 a deploy that stopped first for the backup could not be started
  again by the agent doing it, and the app was down for five minutes for no
  reason. Recreating is also what actually re-resolves a moved `:main` tag —
  `docker restart` reuses the old image layer.

  After the recreate, the boot log must say
  `[db:ensure] done — N migrations applied`; the guard in `scripts/migrate.ts`
  aborts the container rather than serving a database older than the code.
  Then check `curl localhost:3100/` → 200 and that `docker ps` shows only
  `ix-aquaman-aquaman-1` — a missing `-p ix-aquaman` creates a stray
  `rendered-aquaman-1` alongside it.
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
