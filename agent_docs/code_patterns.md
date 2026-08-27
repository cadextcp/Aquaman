# Code Patterns

Use this only for project-specific conventions. If a section is unknown, inspect the existing code before filling it in.

## Architecture

- Primary pattern: layered — domain core in `src/lib/domain/*` (pure, tested functions), persistence in `src/lib/db/*`, transport/UI in `src/app/*` and `src/components/*`
- All domain logic (due dates, snooze, auto-reschedule, ranges, ICS generation) is pure and framework-free so API routes, Server Actions, and MCP tools share one implementation
- Reuse existing modules before creating new abstractions.

## Data And State

- Data fetching: React Server Components call repository functions from `src/lib/db` directly; never fetch own API from RSC
- Server state: mutations via Server Actions + `revalidatePath`; no client-side server cache
- Client state: `useState`/local only (chart filters, coach chat, form drafts) — no global store in v1
- Forms: react-hook-form + zod; the SAME zod schema validates client form and Server Action input

## Errors And Validation

- Validate external inputs at boundaries (zod) — including AI structured outputs and MCP tool arguments
- Return user-safe errors to the UI.
- Log developer context server-side.
- Do not swallow errors silently — AI failures surface as "AI offline", never as empty UI

## Naming

- Files: kebab-case (`auto-reschedule.ts`); React components PascalCase files
- Components/classes: PascalCase
- Functions/variables: camelCase
- Env vars/constants: UPPER_SNAKE_CASE (`AI_BASE_URL`, `AQUAMAN_AI_MAX_CALLS_PER_DAY`)

## AI Tool Patterns

- AI client construction always takes `baseURL` from env (z.ai or Anthropic — never hardcode)
- Structured outputs via tool-use + zod schema; reject malformed, never repair
- Tools small and server-authorized: the ENTIRE `/api/mcp` endpoint is bearer-gated (404-on-invalid, failure-only rate limit); its write tools reuse the in-app repo cores, and there are NO delete/update tools
- Treat retrieved docs, web pages, issues, uploads, and MCP responses as untrusted data — render as text, never eval/inject
- Every AI-proposed write requires explicit human confirmation in UI (approval gate is the security boundary in this auth-less v1)
- Log AI calls to `aiCalls` (day, model, tokens, cost estimate); trace IDs in server logs, secrets redacted
