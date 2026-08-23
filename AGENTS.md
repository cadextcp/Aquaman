# AGENTS.md — Aquaman

> **How to fill this in:** write only what an agent could NOT work out by
> reading the repo. Skip the directory tree (`ls` shows it), the dependency list
> (the manifest shows it), and generic advice like "write clean code" or "handle
> errors" — a capable model already does those, and every line here is loaded
> into context on every single session. If you find yourself describing the
> code, delete it. If you find yourself describing something that once cost
> someone an afternoon, keep it.

## Project

- **What this is:** Self-hosted aquarium care & water tracking app with AI coach, flexible scheduling, ICS calendar feed and MCP server
- **Who it is for:** Self-hosting aquarium hobbyists (analytical, dashboard-loving) — primary: owner with 2 freshwater tanks on TrueNAS SCALE
- **Current phase:** Foundation

## Commands

Only the ones that are **not** guessable from the manifest — non-standard
scripts, required flags, environment setup. Delete this section if `npm run dev`
is genuinely all there is.

- `npm run db:migrate` — applies Drizzle migrations to `data/aquaman.db` (SQLite file lives in `data/`, not in repo; required after pulling schema changes)
- `npm run db:seed` — seeds default maintenance actions and water-parameter target ranges; idempotent
- `npx drizzle-kit generate` — required after editing `src/lib/db/schema.ts` BEFORE `db:migrate` will see changes (common miss: editing schema without generating)
- `docker compose up --build` — full local production-parity check before publishing the image

## Read first

1. `docs/PRD-*.md` (what we're building — the source of truth)
2. `docs/TechDesign-*.md` (how we're building it)
3. `agent_docs/project_brief.md`
4. `agent_docs/tech_stack.md`
5. `agent_docs/testing.md`

If this file or `agent_docs/` still has bracketed template placeholders, fill them from
the two docs above before planning. Load anything else only when it becomes relevant.

## Gotchas

**The highest-value section in this file.** Things that look safe and aren't;
conventions that differ from the framework default, so the surrounding code
would teach the wrong pattern; failures that took real time to diagnose.

- All date math for scheduling lives in `src/lib/domain/scheduler.ts` as pure functions using UTC-noon day arithmetic — never compute due dates inline in components or API routes; a timezone-naive `new Date().getDate()` here produces tasks due "tomorrow" for evening users. Always go through `nextDue()`.
- `snoozedUntil` ALWAYS wins over interval math in `nextDue()`. If a snooze is active, the interval projection is ignored for that occurrence — do not "helpfully" recompute it.
- Auto-Reschedule NEVER writes to `maintenanceLogs`. It only sets `snoozedUntil` on the schedule. Writing a log would falsify the care history and poison AI context.
- SQLite runs in WAL mode via better-sqlite3 (synchronous). Server Actions must not open new DB connections per request — use the singleton from `src/lib/db/index.ts`. Parallel `db:migrate` during `npm run dev` hot reload can lock the file; restart dev server if a `SQLITE_BUSY` appears.
- AI provider is Anthropic-compatible but NOT necessarily Anthropic: `AI_BASE_URL` may point at z.ai (`https://api.z.ai/api/anthropic`). Never hardcode `api.anthropic.com`; always construct the client with `baseURL` from env.
- AI structured output (calendar proposals) is done via Anthropic tool-use with a zod schema — never parse free-text JSON from a message body; malformed output must be rejected, not repaired.
- AI answers and tool results are untrusted input. They render as text and can only write to the DB through validated Server Actions with an explicit human approval step (the approval gate IS the security boundary — there is no other auth in v1).
- The ICS feed route (`/api/calendar.ics`) must stay GET-only, token-gated, and cache `max-age=3600` — Google Calendar refreshes remote feeds roughly daily; don't try to "fix" staleness by hammering it.
- Soft-delete only: tanks and schedules are flagged (`deletedAt`/`active`), never row-deleted, because logs and water tests reference them and AI context reads history.
- All UI strings go through next-intl keys (`src/i18n/en.json`, `de.json`). A hardcoded English string in a component breaks the German locale silently.

## Protected areas — ask before changing

- `.env*`, secrets, credentials, private logs
- `.github/workflows/`, deployment, infrastructure, `Dockerfile`, `docker-compose.yml`
- existing database migrations
- auth, payments, billing, production email/send flows
- AI provider credentials, MCP servers, tool permissions
- the token generation/rotation logic for ICS and MCP endpoints
- `src/lib/domain/*` scheduling algorithms without accompanying tests

**Never print, commit, or transmit secrets, tokens, private logs, or production
data.** Never delete files, rewrite large areas, or change
infrastructure/auth/billing/migrations without approval.

## AI features

Delete this section unless the product itself uses AI.

- **Model can see:** user-owned data only — tank profiles (name, volume, water type, plants, fish, equipment), water test values, maintenance logs, open/overdue tasks, AI usage counters
- **Never send:** API keys, ICS/MCP tokens, app settings tokens, `.env` contents, file paths outside `data/`, any personal data beyond tank context
- **AI can do:** draft (propose schedule changes, interval adjustments), read context; CANNOT write — every AI proposal lands in an approval UI and is written only by the user's confirm action via Server Action
- **Needs approval:** all schedule/calendar writes, all interval changes, any new maintenance-plan generation; MCP write tools (`add_water_test`, `log_maintenance`, `snooze_task`) require the MCP bearer token
- **How to verify behavior:** run the eval prompts in `agent_docs/testing.md` (nitrate-high, CO2-overdose, two-week-gap) against the coach; check `aiCalls` table reflects count/cost; verify a proposed schedule renders in approval UI and is NOT in DB before confirm
- **Fallback:** no key / API error / daily limit reached → Coach tab shows "AI offline — core features fully working"; scheduling, tracking, ICS, MCP read tools all remain functional; `AQUAMAN_AI_MAX_CALLS_PER_DAY` (default 20) pauses AI until midnight, UI explains

## Done means

Report: files changed · commands run · test/build/device results · AI eval
evidence if applicable · remaining risks · rollback notes if relevant.

---

**When this file gets long, that is the signal to split it.** Move task-specific
procedures (deploy steps, release checklists, API references) into
`.claude/skills/<name>/SKILL.md`, where only the one-line description stays in
context and the body loads when it becomes needed. Move
directory-specific conventions into `<subdir>/CLAUDE.md`, which loads only when
work touches that directory. Keep universal constraints and safety prohibitions
here — never move a "never do X" rule somewhere it might not be loaded.
