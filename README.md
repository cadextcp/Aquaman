# 🌊 Aquaman

Self-hosted aquarium care & water tracking with an AI coach, flexible scheduling
and an ICS calendar feed for Google Calendar.

> **Status:** v0.4.0 — MVP + owner feedback rounds + Nocturne redesign +
> proactive AI coach (suggestions & plan review) + **MCP endpoint** for
> remote agents (OpenClaw).
> Planning docs: [`docs/PRD-Aquaman-MVP.md`](docs/PRD-Aquaman-MVP.md) ·
> [`docs/TechDesign-Aquaman-MVP.md`](docs/TechDesign-Aquaman-MVP.md)

## Features

- **Tank management** — name, volume, fresh/salt, plants, fish, equipment, `cycling`/`established` state
- **Flexible scheduling** ⭐ — intervals + preferred weekdays (e.g. weekends only), snooze in one tap, auto-reschedule that keeps a **clean plan without ever hiding your honest backlog** (stress-week friendly by design)
- **Water parameters** — full test suite with target bands; free ammonia (NH₃) computed from NH₄ + pH + temperature (Emerson 1975) and evaluated against fish-toxic thresholds
- **Calendar & ICS feed** — in-app month view + subscribable feed for Google Calendar; stable event identities (snooze moves an event instead of duplicating it)
- **AI coach** — tank-aware advice and schedule proposals via any Anthropic-compatible API (z.ai GLM or Claude); every proposal lands behind an **approval gate** — the AI never writes on its own; two-tier daily cost ceiling (calls + tokens); the app is **fully functional without any AI key**
- **Daily habits** — feeding as a one-tap checkbox (no calendar spam)
- **Statistics** — monthly care activity, median care delay, "interval too tight?" indicators, AI usage/cost retrospective
- **Export / import** — all data as JSON, secrets never included. Your data is yours.
- **MCP endpoint** — remote agents (e.g. OpenClaw) read tank state and record care via the Model Context Protocol at `/api/mcp`; fully bearer-token gated (token shown/rotated under *More*), write tools can log care but **nothing can be deleted or rewritten remotely**, `ask_coach` shares the in-app AI budget
- **English & German** — one setting under *More* switches the whole app: interface, calendar event titles in the ICS feed, and the coach's answers. Adding a language means one JSON file, no code
- **Docker** — one container, one SQLite file, zero cloud

## Quick start (Docker)

```bash
# 1. Get the code
git clone https://github.com/cadextcp/aquaman.git && cd aquaman

# 2. Configure (optional — works without AI keys)
cp .env.example .env   # edit if you want AI features

# 3. Run
docker compose up -d
```

Open `http://localhost:3000` → done. Data lives in `./data` (SQLite + uploads).

> Want just the image? `docker pull ghcr.io/cadextcp/aquaman:latest`

### ⚠️ Security note (read this!)

Aquaman v1 is **single-user without login**. The compose file binds the port to
`127.0.0.1` **on purpose** — put a reverse proxy with auth (Authelia, Basic
Auth, mTLS …) in front of it before exposing it to a network:

```
Internet → Reverse Proxy (HTTPS + auth) → aquaman:3000
```

Do **not** change `127.0.0.1:3000:3000` to `3000:3000` unless the container is
otherwise unreachable from your proxy. Details: [`SECURITY.md`](SECURITY.md).

## Configuration

All configuration is environment variables (see [`.env.example`](.env.example)):

| Variable | Default | What |
|---|---|---|
| `AQUAMAN_TIMEZONE` | `Europe/Berlin` | Governs **all** "today"/midnight logic (due dates, ICS days, AI budget reset) |
| `AQUAMAN_LOCALE` | `en` | Language of a **fresh** install (`en` / `de`). Once set under *More → Language* the stored setting wins |
| `AQUAMAN_AI_BASE_URL` | *(empty → coach off)* | Anthropic-compatible endpoint: `https://api.z.ai/api/anthropic` or `https://api.anthropic.com` |
| `AQUAMAN_AI_API_KEY` | *(empty)* | Provider key — without it everything except the coach works |
| `AQUAMAN_AI_MODEL` | *(empty)* | e.g. `glm-4.6` (z.ai) or `claude-sonnet-4-5` |
| `AQUAMAN_AI_MAX_CALLS_PER_DAY` | `20` | Daily AI call ceiling |
| `AQUAMAN_AI_MAX_TOKENS_PER_DAY` | `200000` | Daily AI token ceiling |

## TrueNAS SCALE (or any Docker host)

**Apps → Discover → Custom App** (or Launch Docker Compose):

| Setting | Value |
|---|---|
| Image | `ghcr.io/cadextcp/aquaman:latest` |
| Port | host `3000` → container `3000`, bound to localhost or the proxy's Docker network |
| Storage | host path e.g. `/mnt/tank/apps/aquaman` → `/app/data` (create first, `chown -R 1000:1000` — the container runs as non-root `node`) |
| Env | see table above |

Verify after start: `http://<host>:3000/api/health` → `{"status":"ok","db":"up"}`

**Backup:** snapshot/mount the `data` directory — that's the entire state
(SQLite + uploads). Or use the in-app JSON export.

## MCP / OpenClaw (v1.1)

Remote agents can talk to AquaMon over the Model Context Protocol:

- **Endpoint:** `http(s)://<your-host>/api/mcp` (Streamable HTTP, JSON responses, stateless)
- **Auth:** `Authorization: Bearer <token>` — get/copy/rotate the token under **More → MCP endpoint**
- **Missing/wrong token → 404**, 30 bad attempts/hour → 429 (same rules as the calendar feed)

Tools: `get_tanks`, `get_water_values`, `get_pending_maintenance`, `add_water_test`,
`log_maintenance`, `snooze_task`, `ask_coach`. Writes go through the exact same
validation as the app; there are **no delete/update tools** — an agent can record
care, never destroy or rewrite history. Coach-proposed plan changes still require
approval in the AquaMon UI.

OpenClaw-style client config:

```json
{
  "mcpServers": {
    "aquaman": {
      "url": "https://aquaman.example.com/api/mcp",
      "headers": { "Authorization": "Bearer <token from More → MCP endpoint>" }
    }
  }
}
```

## Roadmap

- ~~v1.1 — MCP server (bearer-token gated) for OpenClaw/agent remote access~~ → shipped in v0.4.0
- **v2+** — sensors (Home Assistant), multi-user/OIDC, web push

Full plan: [TechDesign §12](docs/TechDesign-Aquaman-MVP.md).

## Development

```bash
npm ci
npm run db:ensure   # migrate + create data/aquaman.db
npm run db:seed     # default actions + water ranges
npm run dev         # http://localhost:3000
```

| Command | What it does |
|---|---|
| `npm run dev` | dev server (auto-migrates) |
| `npm test` | 143 tests — domain unit + route/action integration |
| `npm run typecheck` | TypeScript strict check |
| `npm run lint` | ESLint |
| `npm run build` | production build (standalone) |
| `npm run db:generate` | new migration after schema edit (then `db:ensure`) |

Contributions welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md). If you
change water-parameter ranges, cite a source (animals live in these numbers).

## Architecture (short version)

- Next.js 15 App Router + React 19 + TypeScript
- SQLite + Drizzle (JSON-as-text columns, weekday bitmask)
- Domain core in `src/lib/domain/` — pure, fully tested functions; the same
  `nextDue()` powers dashboard, calendar, ICS and the AI context
- `originalDueAt` never moves (honest backlog) · `plannedFor` is a read-only
  projection (clean plan) — see TechDesign §4.2
- AI proposals flow through one approval-gated action (`applyProposal`) —
  zod-validated against live data before anything is written
- i18n is homegrown (no next-intl): dot-key catalogs in `src/i18n/`, one global
  language setting, and a test that scans the source so a hardcoded string
  cannot quietly ship. Machine surfaces (REST API, MCP, OpenAPI) stay English
  and serve a stable failure `code` the UI translates

## License

MIT — see [`LICENSE`](LICENSE).
