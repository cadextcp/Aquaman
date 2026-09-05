# Project Brief

## Product

- One-line vision: Self-hosted aquarium care & water tracking app with AI coach, flexible scheduling and ICS calendar feed
- Target users: Self-hosting aquarium hobbyists (analytical, dashboard-loving) — primary: owner with 2 freshwater tanks on TrueNAS SCALE
- Primary user outcome: Know at a glance what aquarium care is due today, catch up stress-free after skipping days, and get AI-backed advice on water values

## Scope

- Shipped in v1.0 (tagged 2026-09):
  - Tank management with photos, specs & tankState (cycling/established)
  - Maintenance schedules with weekday selection
  - Flexible scheduling: snooze + auto-reschedule as read-projection, originalDueAt/plannedFor separation, catch-up mode
  - Water parameter tracking with charts incl. NH3 calculation from NH4+pH+temp
  - ICS calendar feed for Google Calendar (expanded VEVENTs, UID keyed on originalDueAt)
  - AI coach & calendar auto-fill with approval gates (calls+tokens cost ceiling)
  - Daily habit tracking for feeding (dashboard checkbox, no ICS spam)
  - Docker deployment via docker compose (local-only port binding)
  - JSON export/import of all data
  - MCP server + bearer-gated REST API `/api/v1`, i18n (en/de), installable PWA
- Shipped after v1.0, on `main` and in production:
  - Product inventory: fertilizer & food products with description and nutrient
    content, compared against the fertilize plan — `docs/plan-produkt-lager.md`,
    migration `0007`. This superseded the earlier "no inventory management"
    scoping: it was ruled out for v1, and v1 had shipped.
  - Drafting a new inventory product from a shop/manufacturer URL or from
    pasted label text — `docs/plan-produkt-import-url.md`, migration `0008`
    for provenance columns.
- Next (nothing committed):
  - Stage 3 of the import plan: photograph the label instead of pasting a URL.
    Feasibility checked 2026-09-05 (the provider does images, and refuses
    unreadable ones); the work is that this app has no upload path at all yet.
- Not planned:
  - Sensor integration & real-time data (architecture stays API-first)
  - Multi-user / OIDC auth
  - Web push notifications
  - Breeding logbook, photo vision AI, community templates

## Principles

- Solve the user story before adding polish.
- Prefer boring, maintainable choices.
- Keep generated docs short and current.
- Verify user-visible work in the real product surface.
- The honest backlog stays visible; the plan stays clean (originalDueAt vs. plannedFor).

## AI Position

- AI is used for: coach chat with tank context (incl. calculated NH3, tankState, backlog); proposing schedules and interval adjustments (structured output via tool-use); (v1.1) `ask_coach` over MCP
- AI is not used for: writing anything directly to the DB; medication dosing advice; anything without a human approval gate
- Human approval required for: every schedule/calendar write proposed by AI; (v1.1) MCP write tools additionally require the bearer token
