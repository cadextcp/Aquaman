# Project Brief

## Product

- One-line vision: Self-hosted aquarium care & water tracking app with AI coach, flexible scheduling and ICS calendar feed
- Target users: Self-hosting aquarium hobbyists (analytical, dashboard-loving) — primary: owner with 2 freshwater tanks on TrueNAS SCALE
- Primary user outcome: Know at a glance what aquarium care is due today, catch up stress-free after skipping days, and get AI-backed advice on water values

## Scope

- Must ship (v1):
  - Tank management with photos, specs & tankState (cycling/established)
  - Maintenance schedules with weekday selection
  - Flexible scheduling: snooze + auto-reschedule as read-projection, originalDueAt/plannedFor separation, catch-up mode
  - Water parameter tracking with charts incl. NH3 calculation from NH4+pH+temp
  - ICS calendar feed for Google Calendar (expanded VEVENTs, UID keyed on originalDueAt)
  - AI coach & calendar auto-fill with approval gates (calls+tokens cost ceiling)
  - Daily habit tracking for feeding (dashboard checkbox, no ICS spam)
  - Docker deployment via docker compose (local-only port binding)
  - JSON export/import of all data
- Not in v1 (but planned):
  - MCP server + OpenClaw → v1.1 (fully bearer-token gated)
- Not planned for v1.x:
  - Sensor integration & real-time data (architecture stays API-first)
  - Multi-user / OIDC auth
  - Web push notifications
  - Food/inventory management, breeding logbook, photo vision AI, community templates

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
