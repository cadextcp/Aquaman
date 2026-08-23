# Tech Stack

Last verified: 2026-08

## Stack

| Area | Choice | Notes |
|------|--------|-------|
| Frontend | Next.js 15 (App Router) + React 19 + TypeScript | One artifact for UI + API + MCP; Server Components keep client JS small (PRD: lightweight, mobile-first); best AI-codegen support for Level-A owner |
| Backend | Next.js API Routes + Server Actions (Node.js runtime) | No separate backend to deploy; domain logic in `src/lib/domain/*` is shared by API routes, Server Actions, and MCP tools — API-first for future sensors |
| Database | SQLite + Drizzle ORM (better-sqlite3) | Local == production (same file); DB at `data/aquaman.db` inside the Docker volume `/app/data`; WAL mode; backups = file copy / TrueNAS snapshot |
| Auth | None in v1 (reverse-proxy auth documented; OIDC planned v2) | Single-user instance behind reverse proxy (Basic/Authelia) with HTTPS at aquaman.cadex64.de; ICS feed and MCP endpoint use secret tokens |
| Styling | Tailwind CSS + shadcn/ui (dark aqua theme, mobile-first) | Bottom-nav on mobile, sidebar ≥ lg; touch targets ≥ 44px; light mode toggle; all strings via next-intl keys |
| Deployment | Docker (multi-stage) on TrueNAS SCALE via ghcr.io image | CI on GitHub Actions (public repo = free): lint → typecheck → test → build → push ghcr.io/<owner>/aquaman |

## Commands

- Setup: `npm ci && npm run db:migrate && npm run db:seed`
- Dev: `npm run dev`
- Test: `npm test`
- Typecheck: `npm run typecheck`
- Lint/format: `npm run lint`
- Build: `npm run build`
- Browser/device check: `npm run dev` → open http://localhost:3000, verify dashboard + one tank flow on mobile viewport (Chrome DevTools iPhone) and desktop

## AI Runtime

- Provider/runtime: Anthropic-compatible HTTP API via `@anthropic-ai/sdk` with `baseURL` from env — supports Anthropic Claude AND z.ai GLM (`https://api.z.ai/api/anthropic`) with one code path
- Model can see:
  - Public: none (no public data in prompts)
  - User-owned: tank profiles, plants/fish lists, equipment flags, water test history, maintenance logs, open/overdue tasks
  - Never send: API keys, ICS/MCP tokens, `.env` values, server paths
- Tools/actions: read only + draft (structured schedule proposals via tool-use); writes happen only in user-confirmed Server Actions
- Approval gates: every AI schedule/interval proposal must be explicitly confirmed by the user in the UI before it is persisted; MCP write tools require bearer token
- Retention/training setting to verify: provider defaults documented in README (both z.ai and Anthropic offer zero-retention options; default retention acceptable for private single-user use)
- Fallback: no key / API failure / daily limit → "AI offline — core features fully working"; scheduling, tests, charts, ICS, MCP reads unaffected; `AQUAMAN_AI_MAX_CALLS_PER_DAY` (default 20) enforced via `aiCalls` table

## Important Patterns

- Data fetching: React Server Components query via `src/lib/db` repository functions; Server Actions for all mutations
- State management: server state via RSC revalidation (`revalidatePath`); client state only in charts/forms/coach chat
- Forms/validation: react-hook-form + zod schemas shared between client form and Server Action
- Error handling: zod-validated boundaries; user-safe error messages; server-side dev logging; AI errors degrade to "AI offline" banner, never block core flows
- Logging/monitoring: `/api/health` for Docker healthcheck; `aiCalls` table as AI telemetry (calls, tokens, cost estimate); no external telemetry
