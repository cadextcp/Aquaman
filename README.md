# 🌊 Aquaman

Self-hosted aquarium care & water tracking with an AI coach, flexible scheduling
and an ICS calendar feed for Google Calendar.

> **Status:** Phase 4 (AI coach) implemented — tanks, scheduling, calendar/ICS, coach live; export & launch next.
> Planning docs: [`docs/PRD-Aquaman-MVP.md`](docs/PRD-Aquaman-MVP.md) ·
> [`docs/TechDesign-Aquaman-MVP.md`](docs/TechDesign-Aquaman-MVP.md)

## Features (planned MVP)

- **Tank management** — name, volume, fresh/salt, plants, fish, equipment, photos, `cycling`/`established` state
- **Flexible scheduling** — intervals + preferred weekdays (e.g. weekends only), snooze, auto-reschedule that **never** hides your honest backlog
- **Water parameters** — full test suite with target bands; free ammonia (NH₃) computed from NH₄ + pH + temperature
- **ICS feed** — subscribe in Google Calendar; stable event identity, no duplicates
- **AI coach** — tank-aware advice and schedule proposals, always behind an approval gate; works fully without any AI key
- **Daily habits** — feeding as a one-tap checkbox (no calendar spam)
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

### ⚠️ Security note (read this!)

Aquaman v1 is **single-user without login**. The compose file binds the port to
`127.0.0.1` **on purpose** — put a reverse proxy with auth (Authelia, Basic
Auth, mTLS …) in front of it before exposing it to a network:

```
Internet → Reverse Proxy (HTTPS + auth) → aquaman:3000
```

Do **not** change `127.0.0.1:3000:3000` to `3000:3000` unless the container is
otherwise unreachable from your proxy.

## Quick start (development)

```bash
npm ci
npm run db:ensure   # migrate + create data/aquaman.db
npm run db:seed     # default actions + water ranges
npm run dev         # http://localhost:3000
```

| Command | What it does |
|---|---|
| `npm run dev` | dev server (auto-migrates) |
| `npm test` | domain unit tests (scheduler, dates, ranges) |
| `npm run typecheck` | TypeScript strict check |
| `npm run lint` | ESLint |
| `npm run build` | production build (standalone) |
| `npm run db:generate` | new migration after schema edit (then `db:ensure`) |

## TrueNAS SCALE

Use **Apps → Discover → Custom App** (or Launch Docker Compose) with:

- Image: `ghcr.io/cadextcp/aquaman:main` (or `:latest` — both track main until v0.1.0)
- Port: host `3000` → container `3000` (bind to localhost/proxy network)
- Storage: host path `/mnt/tank/apps/aquaman/data` → `/app/data`
- Environment: see `.env.example`

Backups = snapshot the `data` dataset (SQLite WAL + uploads inside).

## Architecture (short version)

- Next.js 15 App Router + React 19 + TypeScript
- SQLite + Drizzle (JSON-as-text columns, weekday bitmask)
- Domain core in `src/lib/domain/` — pure, fully tested functions; the same
  `nextDue()` powers dashboard, ICS and (later) MCP
- `originalDueAt` never moves (honest backlog) · `plannedFor` is a read-only
  projection (clean plan) — see TechDesign §4.2

## License

MIT (see `LICENSE` — added with the first release).
