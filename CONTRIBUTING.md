# Contributing to Aquaman

Thanks for considering a contribution! 🐠

## Ground rules

- **Be kind.** This is a hobby project run on evenings — constructive beats exhaustive.
- **Aquarium facts matter.** Water-parameter ranges and care advice touch living animals. If you change ranges or thresholds, cite a source (book, paper, reputable aquarium org) in the PR description — see `src/lib/domain/ranges.ts` for the current sourcing style.
- **No medication dosages.** Health/disease advice stays out of scope; point users to specialist retailers/vets.

## Development setup

```bash
git clone https://github.com/cadextcp/aquaman.git && cd aquaman
npm ci
npm run db:ensure   # migrate + create data/aquaman.db
npm run db:seed     # default actions + water ranges
npm run dev         # http://localhost:3000
```

## Before you open a PR

All of these must pass — CI enforces them, but running locally is faster:

```bash
npm run typecheck   # tsc --noEmit (strict)
npm run lint        # eslint
npm test            # vitest — scheduler/date/ICS logic is heavily unit-tested on purpose
npm run build       # production build
```

### What to test for what you changed

| You touched… | Minimum |
|---|---|
| `src/lib/domain/*` (scheduler, dates, ranges, ICS) | Unit tests — date math is bug hotspot #1. Never use `Date.setHours(0,0,0,0)` or raw `Date.getDay()` (see `AGENTS.md` gotchas) |
| Server Actions / API routes | Integration test against a temp SQLite file (`tests/integration.test.ts` has the pattern) |
| AI behavior (`src/lib/ai/*`) | Data-boundary check: no keys/tokens in anything the model sees; approval-gate invariants hold |
| UI | Check mobile viewport AND desktop — the app is mobile-first |

## Architecture invariants (don't break these)

These exist for reasons documented in `docs/plan-review.md` — please read
`AGENTS.md` before touching scheduling, ICS or AI code:

1. **`originalDueAt` never moves.** Auto-reschedule is a pure read-projection inside `nextDue()` — it must never write to the DB or `maintenanceLogs`.
2. **ICS `UID` is keyed on `originalDueAt`** — a date-keyed UID churns daily in Google Calendar (delete+recreate instead of move).
3. **The AI never writes.** Every proposal goes through `applyProposal` (approval gate) — the only AI write path.
4. **Soft-delete only** — logs and water tests reference tanks; rows are flagged, never deleted.
5. **Existing migrations are immutable** — add a new one instead of editing history.

## Commit style

Conventional commits (`feat:`, `fix:`, `docs:`, `chore:` …) — short subject, optional body explaining *why*.

## Reporting issues

Include: what you did, what you expected, what happened, browser/device, and
the app version (shown in More → top right). Logs from `docker logs aquaman`
help enormously for deployment issues.

## Security

Found something security-relevant? Please see `SECURITY.md` — do not open a
public issue for it.
