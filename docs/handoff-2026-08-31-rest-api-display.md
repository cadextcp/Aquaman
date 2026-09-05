# Historical — REST API + aquarium display, handed over 2026-08-31

> **This is a record of one finished piece of work, not the current state.**
> Archived from the repo root on 2026-09-05 because a file called `HANDOFF.md`
> gets read as "where the project stands", and this one had been overtaken:
> `v1.0.0` shipped after it, then the product inventory and the URL import.
> Where things stand now: `AGENTS.md` (phase), `MEMORY.md` (state and open
> points), `docs/How-It-Works.md` (architecture and the deploy runbook).
>
> Kept because the deploy gotchas and the display/HA bridge wiring below are
> still accurate and still the only written record of them.


Snapshot written 2026-08-31. **The incident described below is RESOLVED**
— kept as reference for the deploy gotchas and the still-pending docs work.
Three repos involved: `aquamon/aquaman/` (this one), `haDisplay/`,
`truenas/` — all local at `C:\Users\cadex\projekte\`.

## TL;DR — what to do next

The incident is fixed and verified in production (see "Resolution" below).
**The documentation pass is also DONE** (2026-08-31, see "Docs — completed"
below). Nothing is broken, nothing is pending except the optional v0.4.0
tag and deleting the NAS backups once production is trusted.

## What this whole thread of work is

1. Built a generic `/api/v1/*` REST API in AquaMon (PR #52, merged) so a
   non-Next client (an ESPHome display) can read/write tank care data.
   OpenAPI/Swagger at `/api/v1/docs`. Full design rationale in
   [`docs/How-It-Works.md`](docs/How-It-Works.md) (MCP section as the
   template) — the file now HAS its "v1 REST API" section (docs pass
   2026-08-31, see "Docs — completed" below).
2. Built `devices/aquarium.yaml` + `common/ui-aquarium-page.yaml` in
   `haDisplay/` — one LVGL page per aquarium (currently 2: FluvalFlex =
   AquaMon tank id 2, Nanocube = tank id 3), each with Feed/Water-change/
   Fertilize buttons that show the last-done day inline. Flashed onto the
   physical Verein-display hardware (temporarily — `devices/verein.yaml`
   and root `verein.yaml` are UNTOUCHED, this is a separate device).
3. Built `V:\packages\aquamon.yaml` (Home Assistant config, mounted as
   drive `V:`) as the bridge: `rest:` sensors poll AquaMon's status
   endpoint, `rest_command:`+`script:` let the display's
   `homeassistant.service:` calls write back to AquaMon.
4. **Full loop verified working end-to-end** on 2026-08-30: button press on
   the physical display → HA script → AquaMon `/api/v1/actions` →
   `maintenance_logs` row with `source: 'api'`. Device paired in HA,
   permission to call HA services enabled.
5. Someone/another session then merged **PR #53** ("standard-events
   catalog") on top — `action_type` is no longer free text, it's now
   restricted to a 10-value catalog + DB CHECK constraint. Verified the
   display's own request strings (`water_change`, `fertilize`) are still
   valid catalog keys — **no display/HA-side code changes were actually
   needed** for that part.
6. **Deploying PR #53 to production broke it** — see "Active incident"
   below. Rolled back. Currently mid-fix.

## Active incident (the reason this handoff exists)

**Symptom:** after redeploying to PR #53's commit (`e7d7472`), the
`ix-aquaman-aquaman-1` container crash-looped (`Restarting`, then
`unhealthy`). `docker logs` showed:

```
Error: Cannot find module '@/lib/domain/action-types'
Require stack:
- /app/src/lib/db/schema.ts
- /app/src/lib/db/index.ts
- /app/scripts/migrate.ts
```

**Root cause:** `Dockerfile`'s runner stage copies `src/` so
`scripts/migrate.ts` can resolve `../src/lib/db` (comment already explains
this), but it never copied `tsconfig.json`. `tsx` (which runs
`migrate.ts`) needs `tsconfig.json` to resolve the `@/*` → `./src/*` path
alias via `get-tsconfig`. This was invisible until PR #53, because
`src/lib/db/schema.ts` had never imported anything via the `@/` alias
before — it only imported from `drizzle-orm`. PR #53 added
`import { ... } from "@/lib/domain/action-types"` to `schema.ts`, which is
in `migrate.ts`'s import graph, so every container boot now fails before
the app can even start.

**Fix, merged as PR #54** (`b27b881`): one line added to `Dockerfile`,
right after `COPY --from=build /app/src ./src`:

```dockerfile
COPY --from=build /app/tsconfig.json ./tsconfig.json
```

## Resolution

1. Built the fixed image directly on the TrueNAS host (Docker Desktop was
   down locally, see "Blocked" below — not pursued further, out of scope).
2. `node_modules/.bin/tsx scripts/migrate.ts` run standalone against a
   scratch data dir inside the built image → clean, no error.
3. Full container run end-to-end on a scratch port (`13100`) → healthy,
   `/api/health` and `/api/v1/openapi.json` both 200.
4. Committed, pushed, PR #54, CI green (`verify` + `docker build/push`),
   merged to `main`.
5. Redeployed to production: stopped container → backed up
   `/mnt/nvda/Aquaman` → `/mnt/nvda/Aquaman-backup-20260831-1811` → pulled
   `ghcr.io/cadextcp/aquaman:main` → `docker compose -p ix-aquaman up -d
   aquaman` (correct project name from the start this time).
6. Verified: revision label `b27b8811b9cb25bf88ec58d08399ca6aac849e33`
   (exactly PR #54's merge commit), `running`/`healthy`,
   `/api/health` → 200, `/api/v1/openapi.json` → 200, `POST /api/v1/actions`
   with `actionType: "water_change"` → 201, with an invalid custom type →
   400 with the catalog list in the error message (standard-events catalog
   from PR #53 confirmed live and enforced).

## Current production state (verified, stable)

- Container `ix-aquaman-aquaman-1` on TrueNAS (`192.168.178.3`), running,
  **healthy**, revision `b27b8811b9cb25bf88ec58d08399ca6aac849e33` — latest
  `main`, includes both PR #53 (standard-events catalog) and PR #54 (this
  fix).
- The aquarium display and HA bridge both confirmed working (they only
  ever send `water_change`/`fertilize`, both valid catalog keys — the
  catalog restriction from PR #53 was never actually the display's
  problem, the Dockerfile bug was).
- Two backup snapshots exist at `/mnt/nvda/Aquaman-backup-20260830-2214`
  and `/mnt/nvda/Aquaman-backup-20260831-1811` — safe to delete once
  production is trusted, per the existing convention in
  `docs/How-It-Works.md`.

## Blocked

**Docker Desktop on this Windows machine will not start.** Error dialog:

```
starting services: initializing Inference manager: listening on
unix://C:\Users\cadex\AppData\Local\Docker\run\dockerInference: remove
C:\Users\cadex\AppData\Local\Docker\run\dockerInference: The file cannot
be accessed by the system. (listener: The filename, directory name, or
volume label syntax is incorrect.)
```

Not investigated further (out of scope for the deploy fix — pivot to
verifying on the TrueNAS host's Docker engine instead, which works fine).
If someone wants to actually fix Docker Desktop: the error points at a
stale/corrupt file at `C:\Users\cadex\AppData\Local\Docker\run\dockerInference`
blocking its own socket cleanup on startup — deleting that path (Docker
Desktop fully stopped first) is the obvious first thing to try, not yet
attempted.

## Deploy recipe (hard-won this session — read before touching the NAS)

TrueNAS's own "Restart" button in the Apps UI apparently pulls-and-recreates
correctly (per the owner) — if GUI access is available, prefer that over
all of the below. CLI recipe, if only SSH is available:

```bash
ssh alex@192.168.178.3
echo '<sudo-pass>' | sudo -S docker pull ghcr.io/cadextcp/aquaman:main
cd /mnt/.ix-apps/app_configs/aquaman/versions/1.4.4/templates/rendered
echo '<sudo-pass>' | sudo -S docker compose -p ix-aquaman up -d aquaman
```

**Gotcha #1 — project name.** `docker compose up -d` from that directory
**without** `-p ix-aquaman` infers the project name from the last path
segment, which is always `rendered` (the fixed TrueNAS template output dir
name) — creates a wrongly-named duplicate container
(`rendered-aquaman-1`) plus a stray `rendered_default` network, while the
real `ix-aquaman-aquaman-1` sits stopped and orphaned. Confirmed
project name for any app: `docker inspect <container> --format
'{{index .Config.Labels "com.docker.compose.project"}}'`. Already
documented in `../truenas/AGENTS.md`.

**Gotcha #2 — rolling back to a specific commit.** The compose file
references the image by `:main` tag, not a digest — you cannot just
`docker tag <old-good-id> ghcr.io/cadextcp/aquaman:main` and `up -d`,
because compose will silently **re-pull** and clobber your local retag
back to whatever the registry currently serves at `:main`. You must add
`--pull never`:

```bash
echo '<sudo-pass>' | sudo -S docker tag <good-image-id> ghcr.io/cadextcp/aquaman:main
echo '<sudo-pass>' | sudo -S docker compose -p ix-aquaman up -d --pull never aquaman
```

Verify after every recreate:
`docker inspect ix-aquaman-aquaman-1 --format '{{index .Config.Labels "org.opencontainers.image.revision"}} | {{.State.Status}} | {{.State.Health.Status}}'`
— check the revision SHA matches what you intended, not just "healthy".

**Backup before any pull+recreate** (SQLite file, container must be
stopped for the copy):

```bash
echo '<sudo-pass>' | sudo -S docker stop ix-aquaman-aquaman-1
echo '<sudo-pass>' | sudo -S cp -a /mnt/nvda/Aquaman /mnt/nvda/Aquaman-backup-$(date +%Y%m%d-%H%M)
# then pull + up -d as above
```

**Finding old image IDs by revision** (useful for rollback):
```bash
docker images ghcr.io/cadextcp/aquaman --format '{{.ID}}\t{{.CreatedSince}}'
# then for each candidate:
docker inspect <id> --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'
```

## Docs — completed (2026-08-31)

The owner asked to document everything in `.md` files and `AGENTS.md`
across all three repos. Everything from the former "still pending" list is
now done:

- `aquaman/docs/How-It-Works.md` — new "v1 REST API (`/api/v1/*`)" section
  between the MCP section and Security model: auth (own bearer token, same
  404/429 contract as MCP), endpoint groups, catalog restriction, feed
  special case, `detailData` inheritance, wall-display consumer.
- `aquaman/AGENTS.md` — two new gotchas in "Next.js / build traps": the
  standard-events catalog as single source of truth (`LOGGABLE_ACTION_TYPES`
  only on `POST /api/v1/actions`, `feed` redirect, `detailData` inheritance)
  and the Docker runner-stage `tsconfig.json` trap (PR #54 root cause).
- `aquaman/MEMORY.md` — "Current State" rewritten: REST API + display live,
  incident resolved on PR #54, coach hardening on main since `ff4ba66`
  (old "uncommitted" note obsolete), next steps = v0.4.0 tag + backup
  cleanup, Docker Desktop blocker noted.
- `truenas/docker-apps.md` — new app #15 AquaMon (container, image, port
  3100→3000, volume, `-p ix-aquaman` project-name warning) + port 3100 in
  the network table.
- Bonus: stale docblock in `src/app/api/v1/actions/route.ts` corrected —
  it still claimed "any actionType string is accepted" (pre-PR #53 truth);
  now states the catalog restriction. Comment-only change.

Earlier (2026-08-30, from the interrupted session): `haDisplay/README.md`,
`haDisplay/docs/aquarium-display.md`, `haDisplay/AGENTS.md`,
`truenas/AGENTS.md` — all done.

## Key facts an agent will need

- **AquaMon prod URL:** `http://192.168.178.3:3100`. API token (More →
  REST API in the app, or `curl .../api/v1/tanks -H "Authorization: Bearer
  <token>"`) — the live token value is in this session's transcript, also
  duplicated into `V:\secrets.yaml` as `aquamon_api_bearer: "Bearer
  <token>"`.
- **SSH:** `ssh alex@192.168.178.3`, key auth works
  (`~/.ssh/truenas_key`), sudo needs a password piped via
  `echo '<pw>' | sudo -S <cmd>`. The password is currently sitting in
  plaintext in `haDisplay/README.md` and `truenas/.claude/settings.local.json`
  — flagged to the owner earlier, not yet rotated/scrubbed.
- **aquaman git:** GitHub CLI (`gh`) is authenticated for
  `cadextcp/aquaman`. Normal workflow observed this session: branch off
  `main`, PR, wait for `ci` workflow (`verify` job always; `docker`
  build/push job only fires on an actual `push` to `main`/`v*` tags, not
  on `pull_request`), merge, then separately deploy (CI does **not**
  auto-deploy to the NAS).
- **Real production tanks:** id 2 = FluvalFlex (60L), id 3 = Nanocube
  (30L) — do not recreate these or add test tanks; the owner explicitly
  asked for real data only, no placeholders, on this instance.
